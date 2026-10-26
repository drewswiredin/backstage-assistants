/**
 * Serializes the rendered page into a compact outline a model can read: open
 * dialogs and drawers first (they are what the user is looking at), then the
 * page content; headings, text, buttons, links, tabs, form fields, tables,
 * alerts, and the first lines of long monospace regions. Nothing is read
 * from app state, so it works on any page without per-plugin code.
 *
 * Pure over a `Document`, with the visibility test injectable: the browser
 * uses layout, the unit tests a `hidden` attribute.
 */

export interface SerializeOptions {
  /** A word or phrase: long monospace regions return the lines around it. */
  find?: string;
  /** Output cap in characters; the result says when it was cut. */
  maxChars?: number;
  /** Whether an element is rendered. Defaults to a layout check. */
  isVisible?: (el: Element) => boolean;
}

export interface PageSnapshot {
  /** The document title. */
  title: string;
  /** The location pathname. */
  path: string;
  /** The outline. */
  content: string;
  /** True when `content` was cut at `maxChars`. */
  truncated: boolean;
  /** Characters before the cut. */
  totalChars: number;
}

export const DEFAULT_MAX_CHARS = 12_000;
/** Lines shown from a long monospace region without `find`. */
const PRE_HEAD_LINES = 80;
/** Lines shown around each `find` match in a monospace region. */
const FIND_CONTEXT_LINES = 10;
const FIND_MAX_MATCHES = 10;

/** Never read: the panel itself and non-content elements. */
const SKIP_SELECTOR = [
  '[data-assistants-panel]',
  '[data-assistants-strip]',
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  '[aria-hidden="true"]',
].join(', ');

/**
 * The portal chrome, skipped only when the walk starts at the body (no
 * `main`): inside `main`, a `nav` is content, such as an entity page's tabs.
 */
const CHROME_SELECTOR =
  'nav, [role="navigation"], header[role="banner"], [role="banner"]';

/**
 * An open dialog or drawer, except the panel's own. MUI classes match as
 * substrings: under a nested ThemeProvider they carry a suffix.
 */
const OVERLAY_SELECTOR = '[role="dialog"], [class*="MuiDrawer-paper"]';

const BLOCK_TAGS = new Set([
  'div',
  'p',
  'section',
  'article',
  'main',
  'aside',
  'form',
  'fieldset',
  'ul',
  'ol',
  'dl',
  'dt',
  'dd',
  'li',
  'table',
  'tr',
  'thead',
  'tbody',
  'tfoot',
  'blockquote',
  'figure',
  'figcaption',
  'hr',
  'br',
  'details',
  'summary',
  'label',
]);

function layoutVisible(el: Element): boolean {
  if ((el as HTMLElement).hidden) return false;
  const rects = el.getClientRects();
  return rects.length > 0;
}

function text(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function labelOf(el: Element): string {
  const aria = text(el.getAttribute('aria-label'));
  if (aria) return aria;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map(id => text(el.ownerDocument.getElementById(id)?.textContent))
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }
  const id = el.getAttribute('id');
  if (id) {
    const label = el.ownerDocument.querySelector(
      `label[for="${
        typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id
      }"]`,
    );
    const t = text(label?.textContent);
    if (t) return t;
  }
  const title = text(el.getAttribute('title'));
  if (title) return title;
  const placeholder = text(el.getAttribute('placeholder'));
  if (placeholder) return placeholder;
  return text(el.textContent);
}

function inputValue(el: Element): string {
  if (el instanceof HTMLSelectElement) {
    return text(el.selectedOptions[0]?.textContent ?? el.value);
  }
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      return el.checked ? 'checked' : 'unchecked';
    }
    if (el.type === 'password') return el.value ? '••••' : '';
    return el.value;
  }
  if (el instanceof HTMLTextAreaElement) return el.value;
  return '';
}

/** Lines of a monospace region: the head, or the lines around each match. */
function monospaceLines(raw: string, find: string | undefined): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  if (find) {
    const needle = find.toLowerCase();
    const ranges: Array<[number, number]> = [];
    let matches = 0;
    for (let i = 0; i < lines.length && matches < FIND_MAX_MATCHES; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        matches++;
        const start = Math.max(0, i - FIND_CONTEXT_LINES);
        const end = Math.min(lines.length, i + FIND_CONTEXT_LINES + 1);
        const last = ranges[ranges.length - 1];
        if (last && start <= last[1]) last[1] = end;
        else ranges.push([start, end]);
      }
    }
    if (matches === 0) {
      return `[no line contains "${find}"; ${lines.length} lines]`;
    }
    const out = ranges.map(
      ([s, e]) => `[lines ${s + 1}-${e}]\n${lines.slice(s, e).join('\n')}`,
    );
    return `${out.join('\n')}\n[${matches} match${
      matches === 1 ? '' : 'es'
    } of "${find}" in ${lines.length} lines]`;
  }
  if (lines.length <= PRE_HEAD_LINES) return lines.join('\n');
  return `${lines.slice(0, PRE_HEAD_LINES).join('\n')}\n[${
    lines.length - PRE_HEAD_LINES
  } more lines; pass find to search them]`;
}

class Writer {
  private parts: string[] = [];
  private lineOpen = false;

  inline(s: string) {
    if (!s) return;
    if (this.lineOpen) {
      const last = this.parts[this.parts.length - 1];
      if (last && !/\s$/.test(last) && !/^[,.;:!?)]/.test(s)) {
        this.parts.push(' ');
      }
    }
    this.parts.push(s);
    this.lineOpen = true;
  }

  line(s: string) {
    this.break();
    this.parts.push(s);
    this.lineOpen = true;
    this.break();
  }

  break() {
    if (this.lineOpen) {
      this.parts.push('\n');
      this.lineOpen = false;
    }
  }

  toString() {
    return this.parts
      .join('')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

function serializeTable(table: HTMLTableElement, w: Writer) {
  w.break();
  for (const row of Array.from(table.rows)) {
    const cells = Array.from(row.cells).map(c => text(c.textContent));
    if (cells.some(Boolean)) w.line(`| ${cells.join(' | ')} |`);
  }
  w.break();
}

function walk(
  node: Node,
  w: Writer,
  o: Required<Pick<SerializeOptions, 'isVisible'>> & {
    find?: string;
    skipChrome: boolean;
  },
  overlays: Set<Element>,
) {
  if (node.nodeType === Node.TEXT_NODE) {
    w.inline(text(node.textContent));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (el.matches(SKIP_SELECTOR)) return;
  if (o.skipChrome && el.matches(CHROME_SELECTOR)) return;
  // Overlays are serialized first, on their own; skip them in the flow.
  if (overlays.has(el)) return;
  if (!o.isVisible(el)) return;

  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');

  if (/^h[1-6]$/.test(tag)) {
    w.line(`${'#'.repeat(Number(tag[1]))} ${text(el.textContent)}`);
    return;
  }
  if (tag === 'table') {
    serializeTable(el as HTMLTableElement, w);
    return;
  }
  if (tag === 'pre' || role === 'log' || role === 'code') {
    w.break();
    w.line(monospaceLines(el.textContent ?? '', o.find));
    return;
  }
  if (role === 'tab') {
    const selected = el.getAttribute('aria-selected') === 'true';
    w.inline(`[tab: ${labelOf(el)}${selected ? ', selected' : ''}]`);
    return;
  }
  if (tag === 'button' || role === 'button' || role === 'menuitem') {
    const label = labelOf(el);
    if (label) {
      const pressed = el.getAttribute('aria-pressed') === 'true';
      const expanded = el.getAttribute('aria-expanded');
      let extra = '';
      if (pressed) extra = ', pressed';
      else if (expanded === 'true') extra = ', expanded';
      w.inline(
        `[${role === 'menuitem' ? 'menu item' : 'button'}: ${label}${extra}]`,
      );
    }
    return;
  }
  if (tag === 'a' && el.hasAttribute('href')) {
    const label = labelOf(el);
    const current = el.getAttribute('aria-current');
    if (label) w.inline(`[link: ${label}${current ? ', current' : ''}]`);
    return;
  }
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    if ((el as HTMLInputElement).type === 'hidden') return;
    const value = inputValue(el);
    w.inline(`[input: ${labelOf(el) || tag}${value ? ` = ${value}` : ''}]`);
    return;
  }
  if (tag === 'img') {
    const alt = text(el.getAttribute('alt'));
    if (alt) w.inline(`[image: ${alt}]`);
    return;
  }
  if (role === 'alert' || role === 'status' || role === 'progressbar') {
    const t = text(el.textContent);
    if (t) w.line(`[${role}: ${t}]`);
    return;
  }
  if (tag === 'li') {
    w.break();
    w.inline('-');
    for (const child of Array.from(el.childNodes)) walk(child, w, o, overlays);
    w.break();
    return;
  }

  const block = BLOCK_TAGS.has(tag) || role === 'region' || role === 'group';
  if (block) w.break();
  for (const child of Array.from(el.childNodes)) walk(child, w, o, overlays);
  if (block) w.break();
}

/**
 * The page as an outline. Open dialogs and drawers come first under a
 * `[dialog: …]` line; then `main` (or the body) with the chrome skipped.
 */
export function serializePage(
  doc: Document,
  options: SerializeOptions = {},
): PageSnapshot {
  const isVisible = options.isVisible ?? layoutVisible;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const root =
    doc.querySelector('main') ?? doc.querySelector('[role="main"]') ?? doc.body;
  const o = { isVisible, find: options.find, skipChrome: root === doc.body };

  const overlays = new Set<Element>(
    Array.from(doc.querySelectorAll(OVERLAY_SELECTOR)).filter(
      el =>
        !el.matches(SKIP_SELECTOR) &&
        !el.closest('[data-assistants-panel], [data-assistants-strip]') &&
        isVisible(el),
    ),
  );
  // Keep only outermost overlays; nested ones serialize with their parent.
  for (const el of Array.from(overlays)) {
    for (const other of overlays) {
      if (other !== el && other.contains(el)) overlays.delete(el);
    }
  }

  const w = new Writer();
  for (const overlay of overlays) {
    const heading = overlay.querySelector('h1, h2, h3, h4, h5, h6');
    const label =
      text(overlay.getAttribute('aria-label')) ||
      text(heading?.textContent) ||
      'open';
    w.line(`[dialog: ${label}]`);
    const inner = new Set(overlays);
    inner.delete(overlay);
    for (const child of Array.from(overlay.childNodes)) {
      walk(child, w, o, inner);
    }
    w.line('[end of dialog]');
  }

  if (root) {
    for (const child of Array.from(root.childNodes)) {
      walk(child, w, o, overlays);
    }
  }

  const full = w.toString();
  const truncated = full.length > maxChars;
  const content = truncated
    ? `${full.slice(0, maxChars)}\n[truncated: ${
        full.length - maxChars
      } more characters; pass find to search for a term]`
    : full;
  return {
    title: text(doc.title),
    path: doc.location?.pathname ?? '',
    content,
    truncated,
    totalChars: full.length,
  };
}
