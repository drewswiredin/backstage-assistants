import {
  isSensitiveElicitationField,
  parseElicitationSchema,
  validateElicitationContent,
  type ElicitationField,
} from './elicitation';

const fieldsOf = (schema: unknown) => {
  const parsed = parseElicitationSchema(schema);
  if (!('fields' in parsed)) throw new Error(parsed.unsupported);
  return parsed.fields;
};

describe('parseElicitationSchema', () => {
  it('reads every field kind of the restricted subset', () => {
    const fields = fieldsOf({
      type: 'object',
      required: ['project'],
      properties: {
        project: {
          type: 'string',
          title: 'Project',
          oneOf: [
            { const: 'pylon', title: 'Pylon' },
            { const: 'tally', title: 'Tally' },
          ],
        },
        team: {
          type: 'string',
          enum: ['a', 'b'],
          enumNames: ['Alpha', 'Beta'],
        },
        email: { type: 'string', format: 'email', maxLength: 80 },
        count: { type: 'integer', minimum: 1, maximum: 9, default: 3 },
        notify: { type: 'boolean', default: true },
        labels: { type: 'array', items: { enum: ['bug', 'ops'] }, maxItems: 2 },
      },
    });
    expect(fields.map(f => [f.name, f.kind, f.required])).toEqual([
      ['project', 'select', true],
      ['team', 'select', false],
      ['email', 'text', false],
      ['count', 'number', false],
      ['notify', 'boolean', false],
      ['labels', 'multiselect', false],
    ]);
    expect(fields[0]).toMatchObject({
      title: 'Project',
      options: [
        { value: 'pylon', label: 'Pylon' },
        { value: 'tally', label: 'Tally' },
      ],
    });
    expect(fields[1]).toMatchObject({
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
    });
    expect(fields[3]).toMatchObject({ integer: true, default: 3 });
  });

  it('says why a schema is outside the subset', () => {
    expect(parseElicitationSchema({ type: 'string' })).toEqual({
      unsupported: 'the request is not an object schema',
    });
    expect(
      parseElicitationSchema({
        type: 'object',
        properties: { where: { type: 'object' } },
      }),
    ).toEqual({ unsupported: "field 'where' has type 'object'" });
    expect(
      parseElicitationSchema({
        type: 'object',
        properties: { ip: { type: 'string', format: 'ipv4' } },
      }),
    ).toEqual({ unsupported: "field 'ip' has format 'ipv4'" });
  });
});

describe('validateElicitationContent', () => {
  const fields: ElicitationField[] = fieldsOf({
    type: 'object',
    required: ['project', 'count'],
    properties: {
      project: { type: 'string', title: 'Project', enum: ['pylon'] },
      count: { type: 'integer', title: 'Count', minimum: 1 },
      email: { type: 'string', title: 'Email', format: 'email' },
      labels: { type: 'array', title: 'Labels', items: { enum: ['bug'] } },
    },
  });

  it('accepts a fitting answer and leaves optional fields out', () => {
    expect(
      validateElicitationContent(fields, { project: 'pylon', count: 2 }),
    ).toEqual([]);
  });

  it('reports each problem', () => {
    expect(
      validateElicitationContent(fields, {
        project: 'other',
        count: 1.5,
        email: 'nope',
        labels: ['feature'],
        extra: true,
      }),
    ).toEqual([
      "'extra' was not asked for",
      'Project must be one of the choices',
      'Count must be a whole number',
      'Email must be a valid email',
      'Labels must be among the choices',
    ]);
    expect(validateElicitationContent(fields, {})).toEqual([
      'Project is required',
      'Count is required',
    ]);
    expect(validateElicitationContent(fields, 'x')).toEqual([
      'The answer must be an object',
    ]);
  });
});

describe('isSensitiveElicitationField', () => {
  it('flags fields that look like secrets', () => {
    expect(
      isSensitiveElicitationField({ name: 'pat', title: 'Access token' }),
    ).toBe(true);
    expect(isSensitiveElicitationField({ name: 'api_key' })).toBe(true);
    expect(
      isSensitiveElicitationField({ name: 'project', title: 'Project' }),
    ).toBe(false);
  });
});
