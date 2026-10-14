import { catalogDocument, htmlToText, techDocsDocuments } from './sources';

describe('techDocsDocuments', () => {
  const root = '/docs/default/component/pylon/';

  it('maps sections to page locations with a heading path', () => {
    const docs = techDocsDocuments(
      [
        { location: 'messaging/', title: 'Messaging', text: '' },
        {
          location: 'messaging/#dead-letter',
          title: 'Dead-letter handling',
          text: '<p>Failed messages land in the <code>pylon-dlq</code> queue.</p>',
        },
        { location: '', title: 'Pylon', text: '<p>Overview &amp; goals</p>' },
      ],
      'component:default/pylon',
      'Pylon',
      root,
    );

    expect(docs).toEqual([
      {
        source: 'techdocs',
        key: `${root}messaging/#dead-letter`,
        entityRef: 'component:default/pylon',
        location: `${root}messaging/`,
        title: 'Pylon › Messaging › Dead-letter handling',
        text: 'Failed messages land in the pylon-dlq queue.',
      },
      {
        source: 'techdocs',
        key: root,
        entityRef: 'component:default/pylon',
        location: root,
        title: 'Pylon',
        text: 'Overview & goals',
      },
    ]);
  });
});

describe('catalogDocument', () => {
  it('describes an entity in a few lines keyed by its ref', () => {
    expect(
      catalogDocument({
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'System',
        metadata: {
          name: 'pylon',
          title: 'Pylon',
          description: 'Message bus for order events.',
          tags: ['messaging'],
        },
        spec: { owner: 'group:default/platform' },
      }),
    ).toEqual({
      source: 'catalog',
      key: 'system:default/pylon',
      entityRef: 'system:default/pylon',
      location: 'system:default/pylon',
      title: 'Pylon',
      text: [
        'Message bus for order events.',
        'System: system:default/pylon',
        'Owner: group:default/platform',
        'Tags: messaging',
      ].join('\n'),
    });
  });
});

describe('htmlToText', () => {
  it('strips tags, decodes entities, and collapses whitespace', () => {
    expect(htmlToText('<h2>Retry</h2>\n<p>Use   &lt;replay&gt;</p>')).toBe(
      'Retry Use <replay>',
    );
    expect(htmlToText(undefined)).toBe('');
  });
});
