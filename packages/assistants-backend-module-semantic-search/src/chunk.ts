import { createHash } from 'node:crypto';
import type { SourceDocument } from './sources';

/** A stored, embedded unit of a {@link SourceDocument}. */
export interface Chunk {
  id: string;
  source: SourceDocument['source'];
  entityRef: string;
  location: string;
  title: string;
  content: string;
  /** Hash of what gets embedded; unchanged hash = no re-embedding. */
  hash: string;
}

const MAX_CHARS = 1600;
const OVERLAP_CHARS = 200;

/**
 * Splits a document into chunks of at most ~1600 characters on word
 * boundaries, overlapping by ~200 so a sentence cut at a boundary survives in
 * one piece. MkDocs sections are usually one chunk already.
 */
export function chunkDocument(doc: SourceDocument): Chunk[] {
  return splitText(doc.text).map((content, index) => ({
    id: sha256(`${doc.source}|${doc.key}|${index}`),
    source: doc.source,
    entityRef: doc.entityRef,
    location: doc.location,
    title: doc.title,
    content,
    hash: sha256(embeddingInput(doc.title, content)),
  }));
}

/** The text a chunk is embedded as: heading path first, so a terse section keeps its context. */
export function embeddingInput(title: string, content: string): string {
  return `${title}\n\n${content}`;
}

export function splitText(text: string): string[] {
  if (text.length <= MAX_CHARS) {
    return [text];
  }
  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + MAX_CHARS, text.length);
    if (end < text.length) {
      const space = text.lastIndexOf(' ', end);
      if (space > start + MAX_CHARS / 2) {
        end = space;
      }
    }
    pieces.push(text.slice(start, end).trim());
    if (end >= text.length) {
      break;
    }
    const restart = text.indexOf(' ', end - OVERLAP_CHARS);
    start = restart > start && restart < end ? restart + 1 : end;
  }
  return pieces.filter(Boolean);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
