import { derivePageContext } from './pageContext';

describe('derivePageContext', () => {
  it('derives the entity ref from a catalog entity page', () => {
    expect(
      derivePageContext(
        '/catalog/default/component/orders/kubernetes',
        'orders | Acme',
      ),
    ).toEqual({
      path: '/catalog/default/component/orders/kubernetes',
      title: 'orders | Acme',
      entityRef: 'component:default/orders',
    });
  });

  it('works under a base path and decodes the segments', () => {
    expect(
      derivePageContext('/portal/catalog/Team%20A/API/pay-api', undefined),
    ).toEqual({
      path: '/portal/catalog/Team%20A/API/pay-api',
      entityRef: 'api:team a/pay-api',
    });
  });

  it('carries only the path elsewhere, and drops a blank title', () => {
    expect(derivePageContext('/create/templates/default/x', '  ')).toEqual({
      path: '/create/templates/default/x',
    });
  });
});
