import { portalNavigateTool, resolvePortalPath } from './portalNavigate';

const origin = 'https://portal.example.com';

describe('resolvePortalPath', () => {
  it('keeps a portal path with its query and hash', () => {
    expect(
      resolvePortalPath(
        '/catalog/default/component/orders?tab=api#defs',
        origin,
      ),
    ).toEqual({ path: '/catalog/default/component/orders?tab=api#defs' });
    expect(resolvePortalPath('  /docs  ', origin)).toEqual({ path: '/docs' });
  });

  it.each([
    ['https://evil.example.com/catalog', 'single /'],
    ['//evil.example.com/catalog', 'single /'],
    ['/\\evil.example.com', 'single /'],
    ['catalog', 'single /'],
    // eslint-disable-next-line no-script-url -- a URL the check must refuse
    ['javascript:alert(1)', 'single /'],
    ['/catalog?next=javascript:alert(1)', 'script or data URL'],
    ['/x?u=%6A%61vascript%3Aalert(1)', 'script or data URL'],
    ['/x#data:text/html,hi', 'script or data URL'],
    ['/api/catalog/entities', 'backend route'],
    ['/api', 'backend route'],
    [`/${'a'.repeat(2000)}`, 'longer than 2000'],
    ['', 'required'],
    [42, 'required'],
  ])('rejects %p', (path, reason) => {
    const resolved = resolvePortalPath(path, origin);
    expect('error' in resolved && resolved.error).toContain(reason);
  });

  it('allows a page whose name only starts with api', () => {
    expect(resolvePortalPath('/api-docs', origin)).toEqual({
      path: '/api-docs',
    });
  });
});

describe('portal__navigate', () => {
  it('only checks the path: it returns the result and leaves navigating to the runtime', async () => {
    const before = window.location.href;
    const execute = portalNavigateTool.execute!;
    const context = { apis: {} as never, signal: new AbortController().signal };
    await expect(execute({ path: '/catalog' }, context)).resolves.toEqual({
      navigated: true,
      path: '/catalog',
    });
    await expect(execute({ path: '//evil' }, context)).resolves.toEqual({
      navigated: false,
      error: expect.stringContaining('single /'),
    });
    expect(window.location.href).toBe(before);
  });

  it('is offered only when the app has the panel', () => {
    const appWith = (node: unknown) => ({
      apis: {
        get: () => ({
          getTree: () => ({
            tree: {
              nodes: new Map(
                node ? [['app-root-wrapper:app/assistants-panel', node]] : [],
              ),
            },
          }),
        }),
      } as never,
    });
    const isAvailable = portalNavigateTool.isAvailable!;
    expect(isAvailable(appWith({ instance: {}, spec: {} }))).toBe(true);
    expect(
      isAvailable(appWith({ instance: {}, spec: { disabled: true } })),
    ).toBe(false);
    expect(isAvailable(appWith(undefined))).toBe(false);
  });
});
