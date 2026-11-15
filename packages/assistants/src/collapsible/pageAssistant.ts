/**
 * Which assistant the Assistants page opens on. The last one open is kept in
 * this browser's localStorage; a missing or unusable store means the default.
 */

/** The assistant last open on this page, so a return visit lands on it. */
const PAGE_ASSISTANT_KEY = 'assistants-page-assistant';

export function loadPageAssistant(): string | undefined {
  try {
    return localStorage.getItem(PAGE_ASSISTANT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function savePageAssistant(id: string) {
  try {
    localStorage.setItem(PAGE_ASSISTANT_KEY, id);
  } catch {
    // storage unavailable
  }
}

/**
 * The assistant the page opens on: the one the URL names, else the one last
 * open here, else the first listed (the default). Each only when the user
 * can still use it.
 */
export function initialPageAssistant(
  assistants: ReadonlyArray<{ id: string }>,
  requested: string | null | undefined,
  remembered: string | undefined,
): string {
  const has = (id: string | null | undefined) =>
    !!id && assistants.some(a => a.id === id);
  if (has(requested)) return requested!;
  if (has(remembered)) return remembered!;
  return assistants[0].id;
}
