import { InputError, ResponseError } from '@backstage/errors';
import type { BackstageCredentials } from '@backstage/backend-plugin-api';
import type { ActionsService } from '@backstage/backend-plugin-api/alpha';
import {
  actionsToTools,
  describeActionError,
  techDocsLocationPath,
} from './actions';

async function responseError(status: number, statusText: string, body: object) {
  return ResponseError.fromResponse({
    ok: false,
    redirected: false,
    type: 'basic',
    status,
    statusText,
    url: 'http://localhost/api/assistants/.backstage/actions/v1/actions/x/invoke',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(body),
  } as Parameters<typeof ResponseError.fromResponse>[0]);
}

async function invokeFailing(error: unknown, maxChars = 10_000) {
  const actionsService = {
    list: jest.fn(),
    invoke: jest.fn().mockRejectedValue(error),
  } as unknown as ActionsService;
  const tools = actionsToTools(
    [
      {
        id: 'assistants:search-knowledge',
        pluginId: 'assistants',
        name: 'search-knowledge',
        title: 'Search Knowledge',
        description: '',
        schema: { input: { type: 'object' }, output: { type: 'object' } },
        attributes: { destructive: false, readOnly: true, idempotent: true },
      },
    ],
    actionsService,
    {} as BackstageCredentials,
    maxChars,
  );
  return tools['search-knowledge'].execute!(
    {},
    { toolCallId: 'call-1', messages: [], context: undefined },
  );
}

describe('action errors', () => {
  it('appends the reason a rejected input gave, on one line, with the status', async () => {
    const issues = JSON.stringify(
      [
        {
          code: 'too_small',
          minimum: 1,
          message: 'Number must be greater than or equal to 1',
          path: ['limit'],
        },
      ],
      null,
      2,
    );
    const error = await responseError(400, 'Bad Request', {
      error: {
        name: 'InputError',
        message: `Invalid input to action "assistants:search-knowledge"; caused by ${issues}`,
        stack: 'InputError: at secret/path.ts:1',
      },
      response: { statusCode: 400 },
    });
    const result = (await invokeFailing(error)) as Record<string, unknown>;
    expect(result).toEqual({
      _error: true,
      status: 400,
      message:
        'Request failed with 400 Bad Request: Invalid input to action "assistants:search-knowledge"; caused by [ { "code": "too_small", "minimum": 1, "message": "Number must be greater than or equal to 1", "path": [ "limit" ] } ]',
    });
    expect(JSON.stringify(result)).not.toContain('secret/path');
  });

  it("passes on an action's own guidance", async () => {
    const error = await responseError(404, 'Not Found', {
      error: {
        name: 'NotFoundError',
        message: 'No TechDocs page at that location; search for it first',
      },
      response: { statusCode: 404 },
    });
    expect(describeActionError(error)).toBe(
      'Request failed with 404 Not Found: No TechDocs page at that location; search for it first',
    );
  });

  it('keeps other errors as they are', async () => {
    expect(await invokeFailing(new InputError('bad input'))).toEqual({
      _error: true,
      message: 'bad input',
    });
    expect(describeActionError('plain')).toBe('plain');
  });

  it('truncates a large reason', async () => {
    const error = await responseError(500, 'Internal Server Error', {
      error: { name: 'Error', message: 'x'.repeat(5000) },
      response: { statusCode: 500 },
    });
    const result = (await invokeFailing(error, 500)) as { message: string };
    expect(result.message.length).toBeLessThan(700);
    expect(result.message.startsWith('Request failed with 500')).toBe(true);
  });
});

describe('techDocsLocationPath', () => {
  it('accepts an absolute documentation path', () => {
    expect(techDocsLocationPath('/docs/default/component/my-service/')).toBe(
      '/docs/default/component/my-service/',
    );
    expect(techDocsLocationPath('/docs/default/component/my-service/api')).toBe(
      '/docs/default/component/my-service/api',
    );
  });

  it('rejects a relative path, a full URL, and a query or fragment', () => {
    expect(() => techDocsLocationPath('docs/default')).toThrow(InputError);
    expect(() => techDocsLocationPath('http://evil.local/x')).toThrow(
      InputError,
    );
    expect(() => techDocsLocationPath('/docs/a?x=1')).toThrow(InputError);
    expect(() => techDocsLocationPath('/docs/a#frag')).toThrow(InputError);
    expect(() => techDocsLocationPath('')).toThrow(InputError);
  });

  it('rejects parent-directory segments', () => {
    expect(() => techDocsLocationPath('/docs/../../api/catalog')).toThrow(
      /'\.\.'/,
    );
    expect(() => techDocsLocationPath('/..')).toThrow(InputError);
  });
});
