/**
 * Dev-app client tools: three small tools that exercise each path of the
 * client tool framework without any external system. A real host contributes
 * tools the same way, from its own plugin or module.
 */
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { AssistantClientToolBlueprint } from '@drewswiredin/backstage-plugin-assistants';

/** Read-only, no credential: runs straight away. */
const browserInfo = AssistantClientToolBlueprint.make({
  name: 'browser-info',
  params: defineParams =>
    defineParams({
      name: 'demo__browser_info',
      title: 'Browser info',
      description:
        "The user's browser language, time zone, local time, and viewport " +
        'size. Read-only.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      attributes: { readOnly: true, idempotent: true },
      execute: async () => ({
        language: navigator.language,
        timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
        localTime: new Date().toString(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }),
    }),
});

/** Not read-only: asks for approval on every call. */
const copyToClipboard = AssistantClientToolBlueprint.make({
  name: 'copy-to-clipboard',
  params: defineParams =>
    defineParams<{ text: string }, { copied: boolean; characters: number }>({
      name: 'demo__copy_to_clipboard',
      title: 'Copy to clipboard',
      description:
        "Copies `text` to the user's clipboard. Use when the user asks to " +
        'copy something.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to copy.' },
        },
        required: ['text'],
        additionalProperties: false,
      },
      attributes: { readOnly: false },
      execute: async ({ text }) => {
        await navigator.clipboard.writeText(text);
        return { copied: true, characters: text.length };
      },
    }),
});

const CONSENT_KEY = 'assistants-demo-connected';

/**
 * Needs a credential: a `custom` acquirer that has one only after the user
 * clicked Connect once in this tab, so the first call shows the Connect
 * control and later calls run silently.
 */
const connectedGreeting = AssistantClientToolBlueprint.make({
  name: 'connected-greeting',
  params: defineParams =>
    defineParams({
      name: 'demo__connected_greeting',
      title: 'Connected greeting',
      description:
        'Returns a greeting from the demo system, which the user must ' +
        'connect first. Read-only.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      attributes: { readOnly: true },
      auth: {
        kind: 'custom',
        system: 'the demo system',
        acquire: async ({ interactive }) => {
          const existing = sessionStorage.getItem(CONSENT_KEY);
          if (existing) return existing;
          if (!interactive) return undefined;
          const token = `demo-${Date.now()}`;
          sessionStorage.setItem(CONSENT_KEY, token);
          return token;
        },
      },
      execute: async (_input, { credential }) => ({
        greeting: 'Hello from the demo system.',
        connectedAs: `token ending ${String(credential).slice(-4)}`,
      }),
    }),
});

export const clientToolsModule = createFrontendModule({
  pluginId: 'assistants',
  extensions: [browserInfo, copyToClipboard, connectedGreeting],
});
