import type { AgentProviderId } from '../../agent-provider.ts';

/**
 * The *inference vendor* a model is served by — `anthropic`, `openai`,
 * `nvidia-nim`, `lmstudio`, `claude-code`. Branded so it cannot be compared
 * against an {@link AgentProviderId}, which names the *agent runtime* driving a
 * chat. The two axes were both spelled `provider` and were compared against each
 * other in the spawn path, which let a same-vendor, wrong-runtime model pass a
 * check that was meant to keep a spawn inside its runtime; the brand turns that
 * mistake into a type error.
 */
export type ModelVendorId = string & {
	readonly __modelVendor: unique symbol;
};

/**
 * Tags a raw vendor string read off a runtime's own catalog as a
 * {@link ModelVendorId}. The one sanctioned way in — call it where a catalog is
 * parsed, never to launder a runtime id into a vendor.
 * @param value - Vendor name exactly as the runtime reported it.
 * @returns The same string, typed as a vendor id.
 */
export function asModelVendorId(value: string): ModelVendorId {
	return value as ModelVendorId;
}

/**
 * One selectable model in the composer's picker, from whichever agent runtime
 * can drive it.
 *
 * The two fields below are different axes and both are load-bearing: `vendor` is
 * the *inference* vendor (`anthropic`, `openai`, `claude-code`) and drives the
 * picker's grouping; `agentProvider` is the *agent runtime* and drives the
 * per-chat provider lock. A Pi chat can run an Anthropic model, and only a
 * Claude chat can run a `claude-code` one.
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
	/** Thinking/effort levels this specific model accepts, in ascending order. */
	thinkingLevels: readonly string[];
	vendor: ModelVendorId;
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
