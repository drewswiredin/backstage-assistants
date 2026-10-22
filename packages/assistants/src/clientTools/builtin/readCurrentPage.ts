/**
 * `read_current_page`: the built-in client tool the model calls to see what
 * the user is looking at. It serializes the rendered page (open dialogs
 * first, then the content, with the portal chrome and the panel itself
 * skipped) into a compact outline. No per-page or per-plugin code: a pod
 * drawer, a logs view, a scaffolder run, and a TechDocs page all come
 * through the same walk. Read-only, so it never asks for approval unless the
 * app lists it in the approval floor.
 */
import type { JsonObject } from '@backstage/types';
import type { AssistantClientTool } from '../types';
import { serializePage, type PageSnapshot } from './pageSerializer';

export const readCurrentPageTool: AssistantClientTool<
  JsonObject,
  PageSnapshot
> = {
  name: 'read_current_page',
  title: 'Read the current page',
  description:
    'Read what the user is looking at in the portal right now: the page\'s headings, text, buttons, links, tabs, tables, form fields, and any open dialog or drawer, as an outline. Call it when the user asks about what is on their screen ("what does this mean", "which button do I press", "why is this failing"). Long logs and code come back cut to their first lines; pass `find` with a word or phrase to get the lines around each match instead.',
  inputSchema: {
    type: 'object',
    properties: {
      find: {
        type: 'string',
        description:
          'A word or phrase to search for in long text on the page (logs, code, output); returns the lines around each match.',
      },
    },
    additionalProperties: false,
  },
  attributes: { readOnly: true, idempotent: true },
  execute: async input => {
    const find = typeof input.find === 'string' ? input.find.trim() : '';
    return serializePage(document, { find: find || undefined });
  },
};
