/**
 * What the panel remembers between page loads: the last quick chat (a server
 * thread id), the assistant the user picked, and the panel width. All live in
 * this browser's localStorage. A missing or unusable store just means a blank
 * panel on the default assistant at the default width.
 */

const THREAD_KEY = 'assistants-panel-thread';
const WIDTH_KEY = 'assistants-panel-width';
const ASSISTANT_KEY = 'assistants-panel-assistant';

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

/** The assistant the user picked in the panel, if any. */
export function loadPanelAssistant(): string | undefined {
  const id = read(ASSISTANT_KEY);
  return id ? id : undefined;
}

const assistantListeners = new Set<(id: string | undefined) => void>();

/**
 * The pick is shared by the panel and the homepage composer: a pick in one
 * reaches the other at once.
 */
export function savePanelAssistant(id: string | undefined) {
  write(ASSISTANT_KEY, id);
  for (const listener of assistantListeners) listener(id);
}

/** Calls `listener` on every pick; returns the unsubscribe. */
export function onPanelAssistantChange(
  listener: (id: string | undefined) => void,
): () => void {
  assistantListeners.add(listener);
  return () => {
    assistantListeners.delete(listener);
  };
}

/**
 * The assistant the panel opens: the user's pick when still accessible, else
 * the default assistant, else the first accessible one. Pure; unit-tested.
 */
export function resolvePanelAssistant<T extends { id: string }>(
  accessible: ReadonlyArray<T>,
  picked: string | undefined,
  defaultId: string | undefined,
): T | undefined {
  return (
    (picked && accessible.find(a => a.id === picked)) ||
    (defaultId && accessible.find(a => a.id === defaultId)) ||
    accessible[0]
  );
}

export function loadPanelWidth(viewportWidth: number): number {
  return clampPanelWidth(Number(read(WIDTH_KEY)), viewportWidth);
}

export function savePanelWidth(width: number) {
  write(WIDTH_KEY, String(Math.round(width)));
}
