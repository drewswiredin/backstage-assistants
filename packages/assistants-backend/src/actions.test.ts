import { InputError } from '@backstage/errors';
import { techDocsLocationPath } from './actions';

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
