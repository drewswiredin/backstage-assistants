import type { LoggerService } from '@backstage/backend-plugin-api';
import { jsonSchema, tool, type Tool } from 'ai';
import {
  BUILTIN_CLIENT_TOOLS,
  CLIENT_TOOL_LIMITS,
  CLIENT_TOOL_NAME_PATTERN,
  type ClientToolDeclaration,
} from '@drewswiredin/backstage-plugin-assistants-common';
import { truncateToolResult } from './truncateToolResult';

/**
 * Client tools: tools the browser declares on each `/chat` request and runs
 * itself, with the user's own browser credentials. assistant-ui's transport
 * sends every registered frontend tool as `tools: { [name]: { description,
 * parameters } }`; the plugin's runtime adds each tool's `attributes`. This
 * module turns that into AI SDK tools with no `execute`, so `streamText`
 * emits the call and yields to the browser, the same mechanism `render_form`
 * has always used.
 *
 * The browser is not trusted to decide what the model may call: a declared
 * tool is offered only when it is a built-in or named in the assistant's
 * `allowedTools`, its name has the client-tool shape, it collides with no
 * server tool, and it is within size and count limits. Everything else is
 * dropped and logged.
 */

/** The `tools` field of a chat request body, or an empty map. */
export function readClientToolDeclarations(
  body: unknown,
): Record<string, unknown> {
  const tools = (body as { tools?: unknown } | undefined)?.tools;
  return tools && typeof tools === 'object' && !Array.isArray(tools)
    ? (tools as Record<string, unknown>)
    : {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates one declaration's shape and size. Returns the reason it is
 * rejected, or undefined when it is acceptable.
 */
function declarationProblem(name: string, value: unknown): string | undefined {
  if (!isPlainObject(value)) return 'declaration is not an object';
  const { description, parameters, attributes } = value;
  if (description !== undefined && typeof description !== 'string') {
    return 'description is not a string';
  }
  if (
    typeof description === 'string' &&
    description.length > CLIENT_TOOL_LIMITS.maxDescriptionChars
  ) {
    return `description exceeds ${CLIENT_TOOL_LIMITS.maxDescriptionChars} characters`;
  }
  if (!isPlainObject(parameters) || parameters.type !== 'object') {
    return 'parameters is not a JSON Schema of type object';
  }
  if (JSON.stringify(parameters).length > CLIENT_TOOL_LIMITS.maxSchemaChars) {
    return `parameters exceeds ${CLIENT_TOOL_LIMITS.maxSchemaChars} characters`;
  }
  if (attributes !== undefined) {
    if (
      !isPlainObject(attributes) ||
      typeof attributes.readOnly !== 'boolean'
    ) {
      return 'attributes.readOnly is not a boolean';
    }
  }
  if (
    !BUILTIN_CLIENT_TOOLS.includes(name) &&
    !CLIENT_TOOL_NAME_PATTERN.test(name)
  ) {
    return 'name is not <namespace>__<tool>';
  }
  return undefined;
}

export interface SelectClientToolsOptions {
  /** The request's `tools` map, unvalidated. */
  declared: Record<string, unknown>;
  /** The client tool names in the assistant's `allowedTools`. */
  allowed: readonly string[];
  /** Names already taken by server tools (actions and MCP tools) this turn. */
  reserved: ReadonlySet<string>;
  logger: LoggerService;
}

/**
 * Filters the browser's declarations to the ones this turn may offer and
 * adapts them to AI SDK tools without `execute`. Built-ins are always
 * offered; every other tool must be in `allowed`. Dropped tools are logged
 * with the reason, never thrown, so one bad declaration cannot fail a turn.
 */
export function selectClientTools({
  declared,
  allowed,
  reserved,
  logger,
}: SelectClientToolsOptions): {
  tools: Record<string, Tool>;
  declarations: Record<string, ClientToolDeclaration>;
} {
  const allowedSet = new Set(allowed);
  const tools: Record<string, Tool> = {};
  const declarations: Record<string, ClientToolDeclaration> = {};
  for (const [name, value] of Object.entries(declared)) {
    const drop = (reason: string) =>
      logger.warn(`client tool '${name}' dropped: ${reason}`, { tool: name });
    const problem = declarationProblem(name, value);
    if (problem) {
      drop(problem);
      continue;
    }
    if (!BUILTIN_CLIENT_TOOLS.includes(name) && !allowedSet.has(name)) {
      drop('not in the assistant allowlist');
      continue;
    }
    if (reserved.has(name)) {
      drop('name collides with a server tool');
      continue;
    }
    if (Object.keys(tools).length >= CLIENT_TOOL_LIMITS.maxPerRequest) {
      drop(`more than ${CLIENT_TOOL_LIMITS.maxPerRequest} client tools`);
      continue;
    }
    const declaration = value as ClientToolDeclaration;
    declarations[name] = declaration;
    // No `execute`: the browser runs the tool and returns the result as the
    // tool output on the next request.
    tools[name] = tool({
      ...(declaration.description !== undefined
        ? { description: declaration.description }
        : {}),
      inputSchema: jsonSchema(declaration.parameters),
    });
  }
  return { tools, declarations };
}

/**
 * Caps the output of every client tool call in the incoming conversation to
 * `maxChars`, the same head-and-tail truncation server tool results get.
 * Client results arrive inside `messages` rather than through a tool's
 * `execute`, so this is where the one budget applies to them, before the
 * model sees them and before the turn is persisted.
 */
export function capClientToolOutputs(
  messages: unknown[],
  clientToolNames: ReadonlySet<string>,
  maxChars: number,
): unknown[] {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return messages;
  return messages.map(message => {
    const m = message as {
      role?: unknown;
      parts?: Array<Record<string, unknown>>;
    };
    if (m.role !== 'assistant' || !Array.isArray(m.parts)) return message;
    let changed = false;
    const parts = m.parts.map(part => {
      const type = part?.type;
      if (
        typeof type !== 'string' ||
        !type.startsWith('tool-') ||
        !clientToolNames.has(type.slice('tool-'.length)) ||
        part.state !== 'output-available'
      ) {
        return part;
      }
      const output = truncateToolResult(part.output, maxChars);
      if (output === part.output) return part;
      changed = true;
      return { ...part, output };
    });
    return changed ? { ...m, parts } : message;
  });
}
