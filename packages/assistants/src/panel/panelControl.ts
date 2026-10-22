import { createContext, useContext } from 'react';
import type {
  ModelId,
  ReasoningLevel,
} from '@drewswiredin/backstage-plugin-assistants-common';

/** What a page component may ask the panel to do. */
export interface PanelOpenOptions {
  /** Open on this assistant (one the user can access); the current one otherwise. */
  assistantId?: string;
  /** Start a fresh conversation and send this as its first message. */
  prompt?: string;
  /** The model for that conversation (one the assistant allows). */
  modelId?: ModelId;
  /** The reasoning effort for that conversation, when the model reasons. */
  reasoningLevel?: ReasoningLevel;
}

/** A first message with its settings, handed to a fresh surface. */
export interface PanelHandoff {
  prompt: string;
  modelId?: ModelId;
  reasoningLevel?: ReasoningLevel;
}

/**
 * The panel's controls, provided by the panel wrapper to everything it
 * encloses, so a page component such as the homepage composer can open the
 * panel without a new API. Undefined where the panel is not installed.
 *
 * @public
 */
export interface PanelControl {
  open(options?: PanelOpenOptions): void;
}

const PanelControlContext = createContext<PanelControl | undefined>(undefined);

export const PanelControlProvider = PanelControlContext.Provider;

/**
 * The panel's controls, or undefined when the app has no panel.
 *
 * @public
 */
export function usePanelControl(): PanelControl | undefined {
  return useContext(PanelControlContext);
}
