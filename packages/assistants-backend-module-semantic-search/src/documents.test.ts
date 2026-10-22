import type { IndexableDocument } from '@backstage/plugin-search-common';
import { htmlToText, toSourceDocuments } from './documents';

const root = '/docs/default/component/pylon/';

describe('toSourceDocuments', () => {
  it('maps TechDocs sections with a heading path, gated by their entity', () => {
    const techdocs = {
      entityTitle: 'Pylon',
      componentType: 'service',
      owner: 'team-a',
      lifecycle: 'production',
      authorization: { resourceRef: 'component:default/pylon' },
    };
    const { documents } = toSourceDocuments([
      {
        ...techdocs,
        location: `${root}messaging/`,
        title: 'Messaging',
        text: '',
      },
      {
        ...techdocs,
        location: `${root}messaging/#dead-letter`,
        title: 'Dead-letter handling',
        text: '<p>Failed messages land in the <code>pylon-dlq</code> queue.</p>',
      },
    ] as IndexableDocument[]);

    expect(documents).toEqual([
      {
        location: `${root}messaging/`,
        entityRef: 'component:default/pylon',
        title: 'Pylon › Messaging',
        text: 'component:default/pylon (service) · Owner: team-a · Lifecycle: production',
      },
      {
        location: `${root}messaging/#dead-letter`,
        entityRef: 'component:default/pylon',
        title: 'Pylon › Messaging › Dead-letter handling',
        text: 'Failed messages land in the pylon-dlq queue.\ncomponent:default/pylon (service) · Owner: team-a · Lifecycle: production',
      },
    ]);
  });

  it('keeps a catalog entity without a description by its facts', () => {
    const { documents } = toSourceDocuments([
      {
        title: 'Payments API',
        text: '',
        location: '/catalog/default/api/payments-api',
        type: 'openapi',
        owner: 'group:default/payments',
        authorization: { resourceRef: 'API:default/payments-api' },
      },
    ] as unknown as IndexableDocument[]);

    expect(documents).toEqual([
      {
        location: '/catalog/default/api/payments-api',
        entityRef: 'api:default/payments-api',
        title: 'Payments API',
        text: 'api:default/payments-api (openapi) · Owner: group:default/payments',
      },
    ]);
  });

  it('keeps documents with no authorization ungated, and skips other resource refs', () => {
    const { documents, skipped } = toSourceDocuments([
      {
        title: 'Release checklist',
        text: 'Freeze the branch on Tuesday.',
        location: 'https://wiki.example.com/pages/42',
      },
      {
        title: 'Restricted',
        text: 'Gated by a non-catalog resource.',
        location: 'https://wiki.example.com/pages/43',
        authorization: { resourceRef: 'not an entity ref' },
      },
      {
        title: 'Duplicate',
        text: 'Same location again.',
        location: 'https://wiki.example.com/pages/42',
      },
    ]);

    expect(documents).toEqual([
      {
        location: 'https://wiki.example.com/pages/42',
        title: 'Release checklist',
        text: 'Freeze the branch on Tuesday.',
      },
    ]);
    expect(skipped).toBe(1);
  });

  it('keeps the short fields a collator attaches as metadata', () => {
    const { documents } = toSourceDocuments([
      {
        title: 'PAY-142: Rotate the Kafka key',
        text: 'Rotated in staging first.',
        location: 'https://jira.example.com/browse/PAY-142',
        key: 'PAY-142',
        status: 'Done',
        labels: ['kafka', 'security'],
        updated: '2026-10-01T09:00:00Z',
        votes: 3,
        owner: 'payments',
        description: 'x'.repeat(500),
        changelog: { items: [] },
      },
    ] as unknown as IndexableDocument[]);

    expect(documents[0].metadata).toEqual({
      key: 'PAY-142',
      status: 'Done',
      labels: 'kafka, security',
      updated: '2026-10-01T09:00:00Z',
      votes: 3,
    });
  });
});

describe('htmlToText', () => {
  it('flattens HTML and decodes entities', () => {
    expect(htmlToText('<p>Overview &amp; goals</p>\n<p>More</p>')).toBe(
      'Overview & goals More',
    );
  });
});
