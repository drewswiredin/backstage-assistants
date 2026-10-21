import type { LoggerService } from '@backstage/backend-plugin-api';
import {
  capClientToolOutputs,
  readClientToolDeclarations,
  selectClientTools,
} from './clientTools';

const schema = { type: 'object', properties: { x: { type: 'string' } } };
const declaration = (extra: Record<string, unknown> = {}) => ({
  description: 'does a thing',
  parameters: schema,
  attributes: { readOnly: true },
  ...extra,
});

function select(
  declared: Record<string, unknown>,
  allowed: string[] = [],
  reserved: string[] = [],
) {
  const dropped: string[] = [];
  const logger = {
    warn: (message: string) => dropped.push(message),
  } as unknown as LoggerService;
  const result = selectClientTools({
    declared,
    allowed,
    reserved: new Set(reserved),
    logger,
  });
  return { ...result, dropped };
}

describe('readClientToolDeclarations', () => {
  it('returns the tools map, or empty for anything else', () => {
    expect(readClientToolDeclarations({ tools: { a: {} } })).toEqual({
      a: {},
    });
    expect(readClientToolDeclarations({})).toEqual({});
    expect(readClientToolDeclarations({ tools: [] })).toEqual({});
    expect(readClientToolDeclarations(undefined)).toEqual({});
  });
});

describe('selectClientTools', () => {
  it('offers built-ins without an allowlist entry and allowlisted tools', () => {
    const { tools, declarations, dropped } = select(
      {
        render_form: declaration(),
        download_file: declaration(),
        kubernetes__get_status: declaration(),
      },
      ['kubernetes__get_status'],
    );
    expect(Object.keys(tools).sort()).toEqual([
      'download_file',
      'kubernetes__get_status',
      'render_form',
    ]);
    expect(declarations.kubernetes__get_status.attributes).toEqual({
      readOnly: true,
    });
    expect(tools.kubernetes__get_status.execute).toBeUndefined();
    expect(dropped).toEqual([]);
  });

  it('drops a tool the assistant does not allow', () => {
    const { tools, dropped } = select({
      kubernetes__get_status: declaration(),
    });
    expect(tools).toEqual({});
    expect(dropped[0]).toContain('not in the assistant allowlist');
  });

  it('drops names outside the <namespace>__<tool> shape', () => {
    const { tools, dropped } = select(
      { 'Bad Name': declaration(), get_status: declaration() },
      ['Bad Name', 'get_status'],
    );
    expect(tools).toEqual({});
    expect(dropped).toHaveLength(2);
    expect(dropped[0]).toContain('<namespace>__<tool>');
  });

  it('drops a name that collides with a server tool', () => {
    const { tools, dropped } = select(
      { github__list_issues: declaration() },
      ['github__list_issues'],
      ['github__list_issues'],
    );
    expect(tools).toEqual({});
    expect(dropped[0]).toContain('collides');
  });

  it('drops malformed and oversized declarations', () => {
    const { tools, dropped } = select(
      {
        ns__no_schema: { description: 'x' },
        ns__not_object: declaration({ parameters: { type: 'string' } }),
        ns__bad_desc: declaration({ description: 'x'.repeat(4001) }),
        ns__big_schema: declaration({
          parameters: {
            type: 'object',
            description: 'y'.repeat(9000),
          },
        }),
        ns__bad_attrs: declaration({ attributes: { readOnly: 'yes' } }),
        ns__fine: declaration(),
      },
      [
        'ns__no_schema',
        'ns__not_object',
        'ns__bad_desc',
        'ns__big_schema',
        'ns__bad_attrs',
        'ns__fine',
      ],
    );
    expect(Object.keys(tools)).toEqual(['ns__fine']);
    expect(dropped).toHaveLength(5);
  });

  it('caps the number of tools per request', () => {
    const declared: Record<string, unknown> = {};
    const allowed: string[] = [];
    for (let i = 0; i < 35; i++) {
      declared[`ns__tool_${i}`] = declaration();
      allowed.push(`ns__tool_${i}`);
    }
    const { tools, dropped } = select(declared, allowed);
    expect(Object.keys(tools)).toHaveLength(30);
    expect(dropped).toHaveLength(5);
    expect(dropped[0]).toContain('more than 30');
  });
});

describe('capClientToolOutputs', () => {
  const big = 'z'.repeat(500);
  const messages = [
    { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    {
      role: 'assistant',
      parts: [
        {
          type: 'tool-kubernetes__get_status',
          state: 'output-available',
          output: { logs: big },
        },
        {
          type: 'tool-search-catalog',
          state: 'output-available',
          output: { logs: big },
        },
        { type: 'tool-kubernetes__get_status', state: 'input-available' },
      ],
    },
  ];

  it('truncates only client tool outputs, leaving other parts alone', () => {
    const capped = capClientToolOutputs(
      messages,
      new Set(['kubernetes__get_status']),
      100,
    ) as typeof messages;
    const parts = capped[1].parts as Array<{ output?: unknown }>;
    expect(typeof parts[0].output).toBe('string');
    expect(parts[0].output as string).toContain('truncated');
    expect(parts[1].output).toEqual({ logs: big });
    expect(parts[2]).toBe(messages[1].parts[2]);
    expect(capped[0]).toBe(messages[0]);
  });

  it('is the identity when nothing exceeds the budget or it is disabled', () => {
    expect(
      capClientToolOutputs(messages, new Set(['kubernetes__get_status']), 0),
    ).toBe(messages);
    const roomy = capClientToolOutputs(
      messages,
      new Set(['kubernetes__get_status']),
      10_000,
    );
    expect(roomy[1]).toBe(messages[1]);
  });
});
