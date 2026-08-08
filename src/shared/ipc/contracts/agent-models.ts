import type { AgentProviderId } from '../../agent-provider.ts';

/**
 * One selectable model in the composer's picker, from whichever agent runtime
 * can drive it.
 *
 * The two provider fields are different axes and both are load-bearing:
 * `provider` is the *inference* provider (`anthropic`, `openai`, `claude-code`)
 * and drives the picker's grouping; `agentProvider` is the *agent runtime* and
 * drives the per-chat provider lock. A Pi chat can run an Anthropic model, and
 * only a Claude chat can run a `claude-code` one.
 */
export interface AgentModelOption {
	agentProvider: AgentProviderId;
	/**
	 * Context window in tokens, as the runtime's own catalog names it. This is
	 * what lets the composer show a denominator on a chat that has never run a
	 * turn — a live session's measurement supersedes it the moment one lands.
	 * `null` when the runtime publishes no window for this model.
	 */
	contextWindow: number | null;
	displayName: string;
	id: string;
	provider: string;
	/** Thinking/effort levels this specific model accepts, in ascending order. */
	thinkingLevels: readonly string[];
}

/**
 * The merged model catalog across every wired-up agent runtime, plus the
 * defaults a new chat starts on. One runtime failing to enumerate its models
 * leaves the others' entries in place rather than emptying the picker.
 */
export interface AgentModelCatalog {
	defaultModelId: string | null;
	defaultThinkingLevel: string | null;
	models: readonly AgentModelOption[];
}

/** An empty catalog, used when no runtime could enumerate its models. */
export const EMPTY_AGENT_MODEL_CATALOG: AgentModelCatalog = {
	defaultModelId: null,
	defaultThinkingLevel: null,
	models: [],
};
