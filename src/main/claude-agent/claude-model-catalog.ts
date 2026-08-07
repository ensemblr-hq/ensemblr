import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';

import type { AgentModelOption } from '../../shared/ipc/contracts/agent-models';
import { toThinkingLevels } from './claude-thinking.ts';

/**
 * Inference provider stamped on every Claude Code model. Claude Code model ids
 * (`sonnet`, `opus[1m]`, …) carry no provider segment, so the picker's grouping
 * key is supplied here rather than parsed out of the id.
 */
const CLAUDE_INFERENCE_PROVIDER = 'claude-code';

/**
 * Model id the SDK uses for "whatever Claude Code would pick". It is a real,
 * selectable option, but it is not a model the user can reason about, so it is
 * dropped from the picker rather than shown alongside named models.
 */
const DEFAULT_MODEL_ALIAS = 'default';

/**
 * Projects `Query.supportedModels()` onto the shared model-catalog wire shape,
 * tagged as Claude's so the picker can group and provider-lock them.
 *
 * Thinking levels come from each model's own `supportedEffortLevels`, not from
 * a shared enum: Pi's levels and Claude's efforts overlap but are different
 * axes, and offering an effort a model would reject is worse than offering
 * fewer.
 * @param models - The models the runtime reported for this account.
 * @returns Catalog entries in the order the runtime listed them.
 */
export function presentClaudeModels(
	models: readonly ModelInfo[],
): readonly AgentModelOption[] {
	return models.flatMap((model) =>
		model.value && model.value !== DEFAULT_MODEL_ALIAS
			? [
					{
						agentProvider: 'claude' as const,
						displayName: model.displayName || model.value,
						id: model.value,
						provider: CLAUDE_INFERENCE_PROVIDER,
						thinkingLevels: toThinkingLevels(model.supportedEffortLevels),
					},
				]
			: [],
	);
}
