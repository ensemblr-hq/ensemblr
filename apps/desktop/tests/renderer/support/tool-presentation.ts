import type { DynamicToolUIPart } from 'ai';

export function dynamicToolCall(
	toolName: string,
	input: Record<string, unknown>,
	output?: { details?: Record<string, unknown>; text: string },
): DynamicToolUIPart {
	if (output === undefined) {
		return {
			input,
			state: 'input-available',
			toolCallId: `${toolName}-1`,
			toolName,
			type: 'dynamic-tool',
		};
	}
	return {
		input,
		output: { details: output.details ?? null, text: output.text },
		state: 'output-available',
		toolCallId: `${toolName}-1`,
		toolName,
		type: 'dynamic-tool',
	};
}
