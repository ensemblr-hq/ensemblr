import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk';

/**
 * What a fake `Query.getContextUsage()` answers with. The adapter probes it as
 * soon as a session is up, so every `Query` fake needs one or the probe reports
 * a missing method instead of a window. Typed as the fields consumers actually
 * read, so the SDK renaming one still fails the build.
 */
export const CONTEXT_USAGE: Pick<
	SDKControlGetContextUsageResponse,
	'maxTokens' | 'model' | 'totalTokens'
> = {
	maxTokens: 1_000_000,
	model: 'claude-opus-5',
	totalTokens: 23_000,
};
