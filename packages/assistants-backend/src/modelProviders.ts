import {
  createExtensionPoint,
  type LoggerService,
} from '@backstage/backend-plugin-api';
import type { Config } from '@backstage/config';
import type { JSONSchema7, JSONValue, LanguageModel } from 'ai';
import type { ReasoningLevel } from '@drewswiredin/backstage-plugin-assistants-common';

/**
 * A tool of the current turn, handed to a provider that runs its own tool
 * loop. `execute` runs the tool as the plugin would: as the user, behind the
 * approval gate and argument rules, and in the browser for a client tool.
 * It resolves once the tool has run (after any approval or browser round
 * trip), with the result the model should see.
 *
 * @public
 */
export interface AssistantsTurnTool {
  /** What the tool does, for the model. */
  description?: string;
  /** The tool's input, as JSON Schema. */
  inputSchema: JSONSchema7;
  /** Run one call; resolves with the result the model should see. */
  execute(
    input: unknown,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown>;
}

/**
 * What a provider learns about the turn it builds a model for.
 *
 * @public
 */
export interface AssistantsModelTurn {
  /**
   * The turn's tools by name. Filled only for a provider with
   * `runsOwnToolLoop`; empty otherwise, since the plugin runs the tools.
   */
  tools: Record<string, AssistantsTurnTool>;
  /** The conversation, when the turn belongs to one. */
  threadId?: string;
  /** Aborted when the user stops the turn. */
  abortSignal: AbortSignal;
}

/**
 * A model provider a backend module contributes for a provider `type` that
 * the plugin doesn't build itself.
 *
 * @public
 */
export interface AssistantsModelProvider {
  /** The model `modelName` (a configured model's `name`) for one turn. */
  languageModel(modelName: string, turn: AssistantsModelTurn): LanguageModel;
  /**
   * True for a provider that executes tools inside its own agent loop (an
   * agent SDK or CLI) rather than returning tool calls for the plugin to run.
   * Such a provider calls `turn.tools[name].execute` itself, and reports each
   * call and result as provider-executed tool parts named as in `turn.tools`.
   */
  runsOwnToolLoop?: boolean;
  /**
   * The `providerOptions` that put a reasoning model at `level`, for models
   * configured with `reasoning: true`. Omitted: the level is not sent.
   */
  reasoningOptions?(
    modelName: string,
    level: ReasoningLevel,
  ): Record<string, Record<string, JSONValue>> | undefined;
}

/**
 * Builds a provider from its `assistants.providers.<id>` config block.
 *
 * @public
 */
export type AssistantsModelProviderFactory = (options: {
  /** The configured provider id, which prefixes its model ids. */
  providerId: string;
  /** The provider's config block (`type`, `models`, and its own keys). */
  config: Config;
  logger: LoggerService;
}) => AssistantsModelProvider;

/**
 * Lets a backend module add model provider types beyond the built-in
 * `openai`, `anthropic`, `azure`, and `openai-compatible`.
 *
 * @public
 */
export interface AssistantsModelProvidersExtensionPoint {
  /** Serve providers configured with `type`. A built-in type can't be replaced. */
  addProviderType(type: string, factory: AssistantsModelProviderFactory): void;
}

/**
 * The extension point for {@link AssistantsModelProvidersExtensionPoint}.
 *
 * @public
 */
export const assistantsModelProvidersExtensionPoint =
  createExtensionPoint<AssistantsModelProvidersExtensionPoint>({
    id: 'assistants.model-providers',
  });
