import { chunkDocument, splitText } from './chunk';
import type { SourceDocument } from './documents';

const doc = (text: string): SourceDocument => ({
  location: '/docs/default/component/pylon/messaging/#retry',
  entityRef: 'component:default/pylon',
  title: 'Pylon › Messaging › Retry',
  text,
});

describe('splitText', () => {
  it('keeps short text whole', () => {
    expect(splitText('one section')).toEqual(['one section']);
  });

  it('splits long text on word boundaries with overlap and loses nothing', () => {
    const words = Array.from({ length: 900 }, (_, i) => `word${i}`);
    const pieces = splitText(words.join(' '));

    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(1600);
      expect(piece).toMatch(/^word\d+( |$)/);
    }
    const covered = new Set(pieces.flatMap(piece => piece.split(' ')));
    expect(words.every(word => covered.has(word))).toBe(true);
    // Consecutive pieces share their boundary words.
    const lastOfFirst = pieces[0].split(' ').slice(-1)[0];
    expect(pieces[1].split(' ')).toContain(lastOfFirst);
  });
});

describe('chunkDocument', () => {
  it('gives stable ids and content hashes', () => {
    const [a] = chunkDocument(doc('Run the replay job.'));
    const [b] = chunkDocument(doc('Run the replay job.'));
    const [c] = chunkDocument(doc('Run the replay job twice.'));

    expect(a.id).toBe(b.id);
    expect(a.hash).toBe(b.hash);
    expect(c.id).toBe(a.id);
    expect(c.hash).not.toBe(a.hash);
    expect(a).toMatchObject({
      entityRef: 'component:default/pylon',
      location: '/docs/default/component/pylon/messaging/#retry',
      title: 'Pylon › Messaging › Retry',
      content: 'Run the replay job.',
    });
  });

  it('hashes metadata apart from the embedded text', () => {
    const base = doc('Rotated in staging first.');
    const [open] = chunkDocument({ ...base, metadata: { status: 'Open' } });
    const [done] = chunkDocument({ ...base, metadata: { status: 'Done' } });

    expect(done.hash).toBe(open.hash);
    expect(done.metadataHash).not.toBe(open.metadataHash);
    expect(done.metadata).toEqual({ status: 'Done' });
  });
});
