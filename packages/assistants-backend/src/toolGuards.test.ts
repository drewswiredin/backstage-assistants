import {
  argumentRuleViolation,
  auditTarget,
  isNotFoundError,
  previewBaseCalls,
  toolResultText,
} from './toolGuards';

describe('argumentRuleViolation', () => {
  const rules = {
    branch: { pattern: /^backstage-assistant\// },
    draft: { equals: true },
  };

  it('passes a call that keeps every rule', () => {
    expect(
      argumentRuleViolation('create_pull_request', rules, {
        branch: 'backstage-assistant/fix-yaml',
        draft: true,
      }),
    ).toBeUndefined();
  });

  it('names the argument and the pattern a call breaks', () => {
    expect(
      argumentRuleViolation('create_pull_request', rules, {
        branch: 'main',
        draft: true,
      }),
    ).toBe(
      `create_pull_request: 'branch' must match ^backstage-assistant\\/ (got "main")`,
    );
  });

  it('enforces equals', () => {
    expect(
      argumentRuleViolation('create_pull_request', rules, {
        branch: 'backstage-assistant/x',
        draft: false,
      }),
    ).toBe(`create_pull_request: 'draft' must be true (got false)`);
  });

  it('fails a missing argument', () => {
    expect(
      argumentRuleViolation('create_pull_request', rules, { draft: true }),
    ).toMatch(/'branch' must match .* \(got nothing\)/);
    expect(
      argumentRuleViolation('create_pull_request', rules, undefined),
    ).toBeDefined();
  });

  it('passes a tool without rules', () => {
    expect(argumentRuleViolation('get_me', undefined, {})).toBeUndefined();
  });
});

describe('auditTarget', () => {
  it('keeps only short identifying arguments, never content', () => {
    expect(
      auditTarget({
        owner: 'acme',
        repo: 'pylon',
        branch: 'backstage-assistant/x',
        path: 'deploy.yaml',
        pull_number: 7,
        content: 'secret: value',
        message: 'commit message',
        token: 'ghu_abc',
        id: 'x'.repeat(201),
      }),
    ).toEqual({
      owner: 'acme',
      repo: 'pylon',
      branch: 'backstage-assistant/x',
      path: 'deploy.yaml',
      pull_number: 7,
    });
  });
});

describe('previewBaseCalls', () => {
  const base = {
    tool: 'get_file_contents',
    args: { owner: 'owner', repo: 'repo', path: 'path', ref: 'branch' },
  };

  it('resolves one read for a file preview', () => {
    expect(
      previewBaseCalls(
        { type: 'file', fields: { path: 'path', content: 'content' }, base },
        { owner: 'acme', repo: 'pylon', path: 'a.yaml', branch: 'b' },
      ),
    ).toEqual([
      {
        path: 'a.yaml',
        args: { owner: 'acme', repo: 'pylon', path: 'a.yaml', ref: 'b' },
      },
    ]);
  });

  it("resolves one read per file, with each file's own path", () => {
    expect(
      previewBaseCalls(
        { type: 'files', fields: { files: 'files' }, base },
        {
          owner: 'acme',
          repo: 'pylon',
          branch: 'b',
          files: [
            { path: 'a.yaml', content: '1' },
            { path: 'b.yaml', content: '2' },
            { content: 'no path' },
          ],
        },
      )?.map(call => call.args.path),
    ).toEqual(['a.yaml', 'b.yaml']);
  });

  it('leaves out arguments the call does not have', () => {
    expect(
      previewBaseCalls(
        { type: 'file', fields: { path: 'path', content: 'content' }, base },
        { owner: 'acme', repo: 'pylon', path: 'a.yaml' },
      )?.[0].args,
    ).toEqual({ owner: 'acme', repo: 'pylon', path: 'a.yaml' });
  });

  it('is undefined without a read tool', () => {
    expect(
      previewBaseCalls(
        { type: 'file', fields: { path: 'path', content: 'content' } },
        {},
      ),
    ).toBeUndefined();
  });
});

describe('toolResultText', () => {
  it('prefers an embedded text resource over text parts', () => {
    expect(
      toolResultText([
        { type: 'text', text: 'downloaded text file' },
        { type: 'resource', resource: { uri: 'repo://a', text: 'a: 1\n' } },
      ]),
    ).toBe('a: 1\n');
  });

  it('joins text parts', () => {
    expect(
      toolResultText([
        { type: 'text', text: 'one' },
        { type: 'text', text: 'two' },
      ]),
    ).toBe('one\ntwo');
  });

  it('is undefined for non-text content', () => {
    expect(
      toolResultText([{ type: 'image', data: 'x', mimeType: 'image/png' }]),
    ).toBeUndefined();
  });
});

describe('isNotFoundError', () => {
  it('recognises not-found messages', () => {
    expect(isNotFoundError('failed to get file: 404 Not Found')).toBe(true);
    expect(isNotFoundError('path does not exist')).toBe(true);
    expect(isNotFoundError('401 Bad credentials')).toBe(false);
  });
});
