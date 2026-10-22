/**
 * What the panel remembers between page loads: the last quick chat (a server
 * thread id) and the panel width. Both live in this browser's localStorage.
 * A missing or unusable store just means a blank panel at the default width.
 */

const THREAD_KEY = 'assistants-panel-thread';
const WIDTH_KEY = 'assistants-panel-width';

export const DEFAULT_PANEL_WIDTH = 420;
export const MIN_PANEL_WIDTH = 320;

/** The panel never covers more than half the viewport. */
export function maxPanelWidth(viewportWidth: number): number {
  return Math.max(MIN_PANEL_WIDTH, Math.floor(viewportWidth / 2));
}

export function clampPanelWidth(width: number, viewportWidth: number): number {
  const max = maxPanelWidth(viewportWidth);
  if (!Number.isFinite(width)) return Math.min(DEFAULT_PANEL_WIDTH, max);
  return Math.min(Math.max(Math.round(width), MIN_PANEL_WIDTH), max);
}

function read(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: string | undefined) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable
  }
}

export function loadPanelThread(): string | undefined {
  const id = read(THREAD_KEY);
  return id ? id : undefined;
}

/** Remember the panel's conversation; `undefined` forgets it (New, hand-off). */
export function savePanelThread(remoteId: string | undefined) {
  write(THREAD_KEY, remoteId);
}

export function loadPanelWidth(viewportWidth: number): number {
  return clampPanelWidth(Number(read(WIDTH_KEY)), viewportWidth);
}

export function savePanelWidth(width: number) {
  write(WIDTH_KEY, String(Math.round(width)));
}
