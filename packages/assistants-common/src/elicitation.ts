/**
 * MCP elicitation: an MCP server stops mid-call to ask the user for input
 * (`elicitation/create`, form mode). The backend shows the question on the
 * tool call as a preliminary tool output marked `_elicitation`, the browser
 * renders it as a form, and the answer goes back through
 * `POST /api/assistants/elicitations/:id` to the server that asked. The
 * model never sees the answer, only the tool's eventual result.
 *
 * The requested schema is MCP's restricted subset: a flat object of
 * primitive properties. {@link parseElicitationSchema} turns it into fields
 * (or says why it is unsupported), and {@link validateElicitationContent}
 * checks an answer against them; the browser and the backend use the same
 * two functions.
 */

/**
 * Where a question stands: `open` waits for the user; the others are how it
 * ended.
 *
 * @public
 */
export type ElicitationStatus =
  | 'open'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'expired';

/**
 * A server's question, as the preliminary output of the tool call it
 * interrupts: `{ _elicitation: ElicitationPrompt }`.
 *
 * @public
 */
export interface ElicitationPrompt {
  /** Answer it at `POST /elicitations/:id`. */
  id: string;
  /** The MCP server id that asked. */
  server: string;
  /** The server's display name. */
  serverTitle: string;
  /**
   * The un-namespaced tool whose call is waiting. Absent when several of the
   * user's calls were running and the server's question didn't say which
   * one asked.
   */
  tool?: string;
  /** The server's question. */
  message: string;
  /** The server's requested schema, as sent. */
  requestedSchema: unknown;
  /** ISO time after which the question is cancelled. */
  expiresAt: string;
  status: ElicitationStatus;
  /** Once accepted: the names of the fields answered (never their values). */
  answered?: string[];
}

/**
 * Body of `POST /api/assistants/elicitations/:id`.
 *
 * @public
 */
export interface ElicitationResponseRequest {
  action: 'accept' | 'decline' | 'cancel';
  /** With `accept`: the answer, keyed by field name. */
  content?: Record<string, unknown>;
}

/**
 * One option of a select field.
 *
 * @public
 */
export interface ElicitationOption {
  value: string;
  label: string;
}

/**
 * One field of a question, parsed from the requested schema.
 *
 * @public
 */
export type ElicitationField = {
  name: string;
  title: string;
  description?: string;
  required: boolean;
} & (
  | {
      kind: 'text';
      format?: 'email' | 'uri' | 'date' | 'date-time';
      minLength?: number;
      maxLength?: number;
      default?: string;
    }
  | {
      kind: 'number';
      integer: boolean;
      minimum?: number;
      maximum?: number;
      default?: number;
    }
  | { kind: 'boolean'; default?: boolean }
  | { kind: 'select'; options: ElicitationOption[]; default?: string }
  | {
      kind: 'multiselect';
      options: ElicitationOption[];
      minItems?: number;
      maxItems?: number;
      default?: string[];
    }
);

const FORMATS = new Set(['email', 'uri', 'date', 'date-time']);

type JsonObject = Record<string, unknown>;
const isObject = (v: unknown): v is JsonObject =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** `enum` (with legacy `enumNames`), or `oneOf`/`anyOf` of `{ const, title }`. */
function optionsOf(schema: JsonObject): ElicitationOption[] | undefined {
  if (Array.isArray(schema.enum)) {
    const names = Array.isArray(schema.enumNames) ? schema.enumNames : [];
    return schema.enum.every(v => typeof v === 'string')
      ? (schema.enum as string[]).map((value, i) => ({
          value,
          label: str(names[i]) ?? value,
        }))
      : undefined;
  }
  let list: unknown[] | undefined;
  if (Array.isArray(schema.oneOf)) list = schema.oneOf;
  else if (Array.isArray(schema.anyOf)) list = schema.anyOf;
  if (!list) return undefined;
  const options = list.map(o =>
    isObject(o) && typeof o.const === 'string'
      ? { value: o.const, label: str(o.title) ?? o.const }
      : undefined,
  );
  return options.every(Boolean) ? (options as ElicitationOption[]) : undefined;
}

/**
 * The fields of a requested schema, or why it can't be shown: anything
 * outside MCP's restricted subset (nested objects, unknown types).
 *
 * @public
 */
export function parseElicitationSchema(
  schema: unknown,
): { fields: ElicitationField[] } | { unsupported: string } {
  if (!isObject(schema) || schema.type !== 'object') {
    return { unsupported: 'the request is not an object schema' };
  }
  const properties = isObject(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required) ? schema.required : [],
  );
  const fields: ElicitationField[] = [];
  for (const [name, raw] of Object.entries(properties)) {
    if (!isObject(raw)) return { unsupported: `field '${name}' has no schema` };
    const base = {
      name,
      title: str(raw.title) ?? name,
      ...(str(raw.description) ? { description: str(raw.description) } : {}),
      required: required.has(name),
    };
    const options = optionsOf(raw);
    if (raw.type === 'string' || (raw.type === undefined && options)) {
      if (options) {
        fields.push({
          ...base,
          kind: 'select',
          options,
          ...(str(raw.default) ? { default: str(raw.default) } : {}),
        });
        continue;
      }
      const format = str(raw.format);
      if (format && !FORMATS.has(format)) {
        return { unsupported: `field '${name}' has format '${format}'` };
      }
      fields.push({
        ...base,
        kind: 'text',
        ...(format ? { format: format as 'email' } : {}),
        ...(num(raw.minLength) !== undefined
          ? { minLength: num(raw.minLength) }
          : {}),
        ...(num(raw.maxLength) !== undefined
          ? { maxLength: num(raw.maxLength) }
          : {}),
        ...(str(raw.default) !== undefined
          ? { default: str(raw.default) }
          : {}),
      });
    } else if (raw.type === 'number' || raw.type === 'integer') {
      fields.push({
        ...base,
        kind: 'number',
        integer: raw.type === 'integer',
        ...(num(raw.minimum) !== undefined
          ? { minimum: num(raw.minimum) }
          : {}),
        ...(num(raw.maximum) !== undefined
          ? { maximum: num(raw.maximum) }
          : {}),
        ...(num(raw.default) !== undefined
          ? { default: num(raw.default) }
          : {}),
      });
    } else if (raw.type === 'boolean') {
      fields.push({
        ...base,
        kind: 'boolean',
        ...(typeof raw.default === 'boolean' ? { default: raw.default } : {}),
      });
    } else if (raw.type === 'array' && isObject(raw.items)) {
      const itemOptions = optionsOf(raw.items);
      if (!itemOptions) {
        return { unsupported: `field '${name}' is a list without choices` };
      }
      fields.push({
        ...base,
        kind: 'multiselect',
        options: itemOptions,
        ...(num(raw.minItems) !== undefined
          ? { minItems: num(raw.minItems) }
          : {}),
        ...(num(raw.maxItems) !== undefined
          ? { maxItems: num(raw.maxItems) }
          : {}),
        ...(Array.isArray(raw.default)
          ? { default: raw.default.filter(v => typeof v === 'string') }
          : {}),
      });
    } else {
      return {
        unsupported: `field '${name}' has type '${String(raw.type)}'`,
      };
    }
  }
  return { fields };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function formatError(format: string, value: string): boolean {
  if (format === 'email') return !EMAIL.test(value);
  if (format === 'date') return !DATE.test(value);
  if (format === 'date-time') return Number.isNaN(Date.parse(value));
  if (format === 'uri') {
    try {
      return !new URL(value).protocol;
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * What is wrong with an answer, one message per problem; empty when it fits
 * the fields. A field left out is fine unless required; a field the question
 * didn't ask for is an error.
 *
 * @public
 */
export function validateElicitationContent(
  fields: ElicitationField[],
  content: unknown,
): string[] {
  if (!isObject(content)) return ['The answer must be an object'];
  const errors: string[] = [];
  const byName = new Map(fields.map(f => [f.name, f]));
  for (const key of Object.keys(content)) {
    if (!byName.has(key)) errors.push(`'${key}' was not asked for`);
  }
  for (const field of fields) {
    const value = content[field.name];
    const label = field.title;
    if (value === undefined || value === '' || value === null) {
      if (field.required) errors.push(`${label} is required`);
      continue;
    }
    switch (field.kind) {
      case 'text':
        if (typeof value !== 'string') {
          errors.push(`${label} must be text`);
        } else if (
          field.minLength !== undefined &&
          value.length < field.minLength
        ) {
          errors.push(`${label} needs at least ${field.minLength} characters`);
        } else if (
          field.maxLength !== undefined &&
          value.length > field.maxLength
        ) {
          errors.push(`${label} allows at most ${field.maxLength} characters`);
        } else if (field.format && formatError(field.format, value)) {
          errors.push(`${label} must be a valid ${field.format}`);
        }
        break;
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          errors.push(`${label} must be a number`);
        } else if (field.integer && !Number.isInteger(value)) {
          errors.push(`${label} must be a whole number`);
        } else if (field.minimum !== undefined && value < field.minimum) {
          errors.push(`${label} must be at least ${field.minimum}`);
        } else if (field.maximum !== undefined && value > field.maximum) {
          errors.push(`${label} must be at most ${field.maximum}`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean')
          errors.push(`${label} must be yes or no`);
        break;
      case 'select':
        if (!field.options.some(o => o.value === value)) {
          errors.push(`${label} must be one of the choices`);
        }
        break;
      case 'multiselect':
        if (
          !Array.isArray(value) ||
          !value.every(v => field.options.some(o => o.value === v))
        ) {
          errors.push(`${label} must be among the choices`);
        } else if (
          field.minItems !== undefined &&
          value.length < field.minItems
        ) {
          errors.push(`${label} needs at least ${field.minItems} choices`);
        } else if (
          field.maxItems !== undefined &&
          value.length > field.maxItems
        ) {
          errors.push(`${label} allows at most ${field.maxItems} choices`);
        }
        break;
      default:
        break;
    }
  }
  return errors;
}

/**
 * True for a field that looks like it asks for a secret. MCP servers must
 * not ask for passwords or tokens through elicitation; the form warns and
 * leans to Decline when one does.
 *
 * @public
 */
export function isSensitiveElicitationField(field: {
  name: string;
  title?: string;
}): boolean {
  return /password|passphrase|secret|token|api[-_ ]?key|ssn/i.test(
    `${field.name} ${field.title ?? ''}`,
  );
}
