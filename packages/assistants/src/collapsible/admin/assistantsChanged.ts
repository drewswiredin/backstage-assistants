/**
 * The editor's changes (create, edit, delete, default, order), told to
 * surfaces outside the Assistants page in this tab. The panel is mounted at
 * the app root and loads the assistant list once, so without this it keeps
 * the old list (and an assistant's old colour) until the app reloads.
 */
const listeners = new Set<() => void>();

export function notifyAssistantsChanged() {
  for (const listener of listeners) listener();
}

/** Calls `listener` after every change; returns the unsubscribe. */
export function onAssistantsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
