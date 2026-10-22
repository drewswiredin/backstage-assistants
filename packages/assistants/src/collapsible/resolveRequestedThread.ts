/**
 * Resolves a deep-linked thread (`/assistants/threads/:threadId`, a server
 * thread id) against the loaded thread list. The list already holds every
 * thread the caller can see, archived ones included, so a miss means the
 * thread is unknown, deleted, or someone else's — all land the same way.
 */
import type { ThreadListState } from '@assistant-ui/react';
import type { ThreadCustomMetadata } from './threadListAdapter';

export interface RequestedThread {
  /** assistant-ui's local id, for `switchToThread`. */
  threadId: string;
  /** The owning assistant, to focus before switching. */
  assistantId: string;
}

export function resolveRequestedThread(
  threadList: Pick<ThreadListState, 'threadIds' | 'threadItems'> & {
    archivedThreadIds?: readonly string[];
  },
  remoteId: string | undefined,
): RequestedThread | undefined {
  if (!remoteId) return undefined;
  const ids = [
    ...threadList.threadIds,
    ...(threadList.archivedThreadIds ?? []),
  ];
  for (const id of ids) {
    const item = threadList.threadItems[id];
    if (item?.remoteId !== remoteId) continue;
    const assistantId = (
      item.custom as Partial<ThreadCustomMetadata> | undefined
    )?.assistantId;
    if (!assistantId) return undefined;
    return { threadId: id, assistantId };
  }
  return undefined;
}
