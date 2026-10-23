import { resolvePreviewField } from '@drewswiredin/backstage-plugin-assistants-common';
import type { ArgumentRule, McpApprovalPreview } from './config';

/**
 * Server-side guards around MCP tool calls: argument rules, the audit record's
 * target, and the read calls behind an approval preview's diff.
 */

/**
 * The first argument rule the input breaks, as a message for the model, or
 * undefined when every rule holds. A missing argument breaks its rule, so a
 * call cannot slip past a rule by leaving the argument out.
 */
export function argumentRuleViolation(
  toolName: string,
  rules: Record<string, ArgumentRule> | undefined,
  input: unknown,
): string | undefined {
  if (!rules) return undefined;
  const args =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  for (const [arg, rule] of Object.entries(rules)) {
    const value = args[arg];
    if (
      rule.pattern &&
      !(typeof value === 'string' && rule.pattern.test(value))
    ) {
      return `${toolName}: '${arg}' must match ${rule.pattern.source} (got ${
        JSON.stringify(value) ?? 'nothing'
      })`;
    }
    if (rule.equals !== undefined && value !== rule.equals) {
      return `${toolName}: '${arg}' must be ${JSON.stringify(
        rule.equals,
      )} (got ${JSON.stringify(value) ?? 'nothing'})`;
    }
  }
  return undefined;
}

/**
 * Arguments that name what a call acts on. The audit record carries only
 * these, and only short scalar values: never content, messages, or tokens.
 */
const TARGET_ARGS = [
  'owner',
  'repo',
  'branch',
  'base',
  'head',
  'ref',
  'path',
  'number',
  'issue_number',
  'pull_number',
  'project',
  'key',
  'id',
];

/** The audit record's `target`: the call's whitelisted identifying arguments. */
export function auditTarget(input: unknown): Record<string, string | number> {
  const args =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  const target: Record<string, string | number> = {};
  for (const name of TARGET_ARGS) {
    const value = args[name];
    if (typeof value === 'number') {
      target[name] = value;
    } else if (typeof value === 'string' && value.length <= 200) {
      target[name] = value;
    }
  }
  return target;
}

/** One read call behind an approval preview: the file path and the read tool's arguments. */
export interface PreviewBaseCall {
  path: string;
  args: Record<string, unknown>;
}

/**
 * The read calls for an approval preview's diff: one for a `file` preview,
 * one per file entry for `files` (each resolved over the input merged with
 * the entry, so `path` is the file's own). Undefined when the preview has no
 * read tool.
 */
export function previewBaseCalls(
  preview: McpApprovalPreview,
  input: Record<string, unknown>,
): PreviewBaseCall[] | undefined {
  const base = preview.base;
  if (!base) return undefined;
  const resolveArgs = (scope: Record<string, unknown>) => {
    const args: Record<string, unknown> = {};
    for (const [name, template] of Object.entries(base.args)) {
      const value = resolvePreviewField(template, scope);
      if (value !== undefined && value !== '') args[name] = value;
    }
    return args;
  };
  if (preview.type === 'file') {
    const path = resolvePreviewField(preview.fields.path, input);
    return typeof path === 'string' ? [{ path, args: resolveArgs(input) }] : [];
  }
  const files = resolvePreviewField(preview.fields.files, input);
  if (!Array.isArray(files)) return [];
  return files.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const file = entry as Record<string, unknown>;
    if (typeof file.path !== 'string') return [];
    return [{ path: file.path, args: resolveArgs({ ...input, ...file }) }];
  });
}

/**
 * The text of an MCP tool result: embedded text resources first (how file
 * readers return a file), then text parts. Undefined when there is none.
 */
export function toolResultText(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : undefined;
  }
  const parts = content as Array<{
    type?: string;
    text?: unknown;
    resource?: { text?: unknown };
  }>;
  const resource = parts.find(
    p => p.type === 'resource' && typeof p.resource?.text === 'string',
  );
  if (resource) return resource.resource!.text as string;
  const texts = parts
    .filter(p => p.type === 'text' && typeof p.text === 'string')
    .map(p => p.text as string);
  return texts.length > 0 ? texts.join('\n') : undefined;
}

/** True when a read tool's error says the target does not exist. */
export function isNotFoundError(message: string): boolean {
  return /\b404\b|not found|does not exist|no such file/i.test(message);
}
