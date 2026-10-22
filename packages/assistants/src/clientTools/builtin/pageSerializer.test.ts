import { serializePage } from './pageSerializer';

/** jsdom has no layout, so visibility is the `hidden` attribute here. */
const isVisible = (el: Element) =>
  !el.hasAttribute('hidden') && !el.closest('[hidden]');

function page(html: string, title = 'Test page') {
  document.title = title;
  document.body.innerHTML = html;
  return (find?: string, maxChars?: number) =>
    serializePage(document, { isVisible, find, maxChars });
}

describe('serializePage', () => {
  it('reads the content, skipping the chrome and the panel', () => {
    const read = page(`
      <nav><a href="/catalog">Catalog</a></nav>
      <header role="banner">Acme Portal</header>
      <main>
        <h1>orders</h1>
        <div role="tablist">
          <button role="tab" aria-selected="true">Overview</button>
          <button role="tab" aria-selected="false">Kubernetes</button>
        </div>
        <p>Owned by <a href="/catalog/default/group/payments">payments</a>.</p>
        <button>Register existing API</button>
        <img alt="Status: healthy" src="x.png" />
      </main>
      <aside data-assistants-panel="true"><p>Ask me anything</p></aside>
    `);
    const { content, truncated } = read();
    expect(truncated).toBe(false);
    expect(content).toContain('# orders');
    expect(content).toContain('[tab: Overview, selected]');
    expect(content).toContain('[tab: Kubernetes]');
    expect(content).toContain('[link: payments]');
    expect(content).toContain('[button: Register existing API]');
    expect(content).toContain('[image: Status: healthy]');
    expect(content).not.toContain('Catalog');
    expect(content).not.toContain('Acme Portal');
    expect(content).not.toContain('Ask me anything');
  });

  it('puts an open dialog first and skips hidden elements', () => {
    const read = page(`
      <main>
        <h1>Pods</h1>
        <div hidden><p>collapsed details</p></div>
        <table>
          <thead><tr><th>Name</th><th>Status</th></tr></thead>
          <tbody><tr><td>orders-7d9f</td><td>CrashLoopBackOff</td></tr></tbody>
        </table>
      </main>
      <div role="dialog" aria-label="Pod orders-7d9f">
        <h2>orders-7d9f</h2>
        <label for="ns">Namespace</label><input id="ns" value="prod" />
        <div role="alert">Container restarted 5 times</div>
      </div>
    `);
    const { content } = read();
    expect(content.startsWith('[dialog: Pod orders-7d9f]')).toBe(true);
    expect(content).toContain('[input: Namespace = prod]');
    expect(content).toContain('[alert: Container restarted 5 times]');
    expect(content).toContain('[end of dialog]');
    expect(content.indexOf('[end of dialog]')).toBeLessThan(
      content.indexOf('# Pods'),
    );
    expect(content).toContain('| Name | Status |');
    expect(content).toContain('| orders-7d9f | CrashLoopBackOff |');
    expect(content).not.toContain('collapsed details');
  });

  it('cuts long monospace regions and finds lines around a term', () => {
    const lines = Array.from({ length: 200 }, (_, i) =>
      i === 150 ? `line ${i + 1} OOMKilled here` : `line ${i + 1}`,
    );
    const read = page(`<main><pre>${lines.join('\n')}</pre></main>`);
    const head = read().content;
    expect(head).toContain('line 80');
    expect(head).not.toContain('line 81\n');
    expect(head).toContain('[120 more lines; pass find to search them]');

    const found = read('oomkilled').content;
    expect(found).toContain('[lines 141-161]');
    expect(found).toContain('line 151 OOMKilled here');
    expect(found).not.toContain('line 1\n');
    expect(found).toContain('[1 match of "oomkilled" in 200 lines]');

    expect(read('absent').content).toContain(
      '[no line contains "absent"; 200 lines]',
    );
  });

  it('truncates at the cap and says so', () => {
    const read = page(`<main><p>${'word '.repeat(2000)}</p></main>`);
    const { content, truncated, totalChars } = read(undefined, 500);
    expect(truncated).toBe(true);
    expect(totalChars).toBeGreaterThan(500);
    expect(content).toMatch(/\[truncated: \d+ more characters; pass find/);
    expect(content.length).toBeLessThan(620);
  });

  it('reports the title and path', () => {
    const read = page('<main><p>hi</p></main>', 'orders | Acme');
    const snap = read();
    expect(snap.title).toBe('orders | Acme');
    expect(typeof snap.path).toBe('string');
  });
});
