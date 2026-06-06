/**
 * In-memory resumable stream registry (single backend replica).
 *
 * Buffers a copy of each `/chat` SSE stream keyed by a stream id, so a client
 * that reconnects mid-flight (`GET /chat/resume/:id`) can replay the buffered
 * chunks and then tail the live remainder. This buffer is throwaway — it's
 * cleaned up shortly after the stream completes; conversation history stays
 * durable in the database regardless.
 *
 * Single-replica only: the buffer lives in this process's memory, so a resume
 * request must hit the same backend instance that served the original turn.
 */

interface ResumableEntry {
  userRef: string;
  chunks: string[];
  done: boolean;
  listeners: Set<(chunk: string | null) => void>;
}

/** What {@link ResumableStreamRegistry.subscribe} returns for a known stream. */
export interface ResumableSubscription {
  /** Chunks buffered so far — write these first. */
  buffered: string[];
  /** True if the stream already completed (no live tail to wait for). */
  done: boolean;
  /** Detach the live-tail listener (call on client disconnect). */
  unsubscribe: () => void;
}

export class ResumableStreamRegistry {
  private readonly streams = new Map<string, ResumableEntry>();
  private readonly ttlMs: number;

  constructor(opts?: { ttlMs?: number }) {
    this.ttlMs = opts?.ttlMs ?? 60_000;
  }

  /** Begin buffering an SSE stream under `id` (owned by `userRef`). */
  start(id: string, userRef: string, stream: ReadableStream<string>): void {
    const entry: ResumableEntry = {
      userRef,
      chunks: [],
      done: false,
      listeners: new Set(),
    };
    this.streams.set(id, entry);
    void this.pump(id, entry, stream);
  }

  private async pump(
    id: string,
    entry: ResumableEntry,
    stream: ReadableStream<string>,
  ): Promise<void> {
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          entry.chunks.push(value);
          for (const listener of entry.listeners) listener(value);
        }
      }
    } catch {
      // Stream error — fall through to completion so tail subscribers close.
    } finally {
      entry.done = true;
      for (const listener of entry.listeners) listener(null);
      entry.listeners.clear();
      // Keep the buffer briefly for a late reconnect, then drop it.
      setTimeout(() => this.streams.delete(id), this.ttlMs).unref?.();
    }
  }

  /**
   * Subscribe to a stream's replay + live tail. Returns the buffered chunks plus
   * a live-tail registration, or null if the id is unknown/expired or not owned
   * by `userRef`. `onChunk` receives each subsequent chunk, then null at the end.
   *
   * Race-free: the pump only mutates state at `await` points, so this fully
   * synchronous snapshot-then-attach can't miss or duplicate a chunk.
   */
  subscribe(
    id: string,
    userRef: string,
    onChunk: (chunk: string | null) => void,
  ): ResumableSubscription | null {
    const entry = this.streams.get(id);
    if (!entry || entry.userRef !== userRef) return null;
    const buffered = [...entry.chunks];
    if (entry.done) {
      return { buffered, done: true, unsubscribe: () => {} };
    }
    entry.listeners.add(onChunk);
    return {
      buffered,
      done: false,
      unsubscribe: () => entry.listeners.delete(onChunk),
    };
  }
}
