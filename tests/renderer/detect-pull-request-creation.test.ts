import { describe, expect, test } from 'vitest';
import {
	classifyPullRequestRefreshAction,
	isFinishedTurnEvent,
	isPullRequestCreationEvent,
} from '../../src/renderer/hooks/workbench-shell/route-layout/detect-pull-request-creation';
import type {
	PiPersistedEnvelope,
	PiWireMessagePart,
} from '../../src/shared/ipc/contracts/pi-message-payloads';

/** Wraps a tool-call payload in the persisted message envelope shape. */
function toolCall(input: unknown): PiPersistedEnvelope {
	return {
		kind: 'message',
		payload: { input, kind: 'tool-call', name: 'Bash', toolCallId: 'c1' },
		role: 'tool',
	};
}

/** Wraps a tool-result payload in the persisted message envelope shape. */
function toolResult(output: unknown): PiPersistedEnvelope {
	return {
		kind: 'message',
		payload: { isError: false, kind: 'tool-result', output, toolCallId: 'c1' },
		role: 'tool',
	};
}

/** Wraps finalized assistant message parts in the persisted envelope shape. */
function assistantMessage(
	parts: readonly PiWireMessagePart[],
): PiPersistedEnvelope {
	return {
		kind: 'message',
		payload: { kind: 'message', parts, role: 'assistant' },
		role: 'agent',
	};
}

describe('isPullRequestCreationEvent', () => {
	test('detects a gh pr create tool call', () => {
		expect(
			isPullRequestCreationEvent(toolCall({ command: 'gh pr create --fill' })),
		).toBe(true);
	});

	test('detects a PR URL in tool-result output', () => {
		expect(
			isPullRequestCreationEvent(
				toolResult('https://github.com/acme/app/pull/12'),
			),
		).toBe(true);
	});

	test('detects a PR URL in structured tool-result output', () => {
		expect(
			isPullRequestCreationEvent(
				toolResult({ stdout: 'https://github.com/acme/app/pull/12' }),
			),
		).toBe(true);
	});

	test('detects a PR URL in a finalized assistant tool-result part', () => {
		expect(
			isPullRequestCreationEvent(
				assistantMessage([
					{
						isError: false,
						kind: 'tool-result',
						output: 'https://github.com/acme/app/pull/12',
						toolCallId: 'c1',
					},
				]),
			),
		).toBe(true);
	});

	test('ignores unrelated tool activity', () => {
		expect(
			isPullRequestCreationEvent(toolCall({ command: 'npm run check' })),
		).toBe(false);
		expect(isPullRequestCreationEvent(toolResult('all tests passed'))).toBe(
			false,
		);
	});

	test('ignores a viewing command whose input carries a PR URL', () => {
		expect(
			isPullRequestCreationEvent(
				toolCall({ command: 'gh pr view https://github.com/acme/app/pull/9' }),
			),
		).toBe(false);
	});

	test('ignores non-tool envelopes', () => {
		expect(
			isPullRequestCreationEvent({
				kind: 'status',
				previous: 'streaming',
				status: 'idle',
			}),
		).toBe(false);
	});
});

/** Status envelope for a streaming/starting/idle transition. */
function status(
	current: 'starting' | 'streaming' | 'idle',
	previous: 'starting' | 'streaming' | 'idle',
): PiPersistedEnvelope {
	return { kind: 'status', previous, status: current };
}

describe('classifyPullRequestRefreshAction', () => {
	test('arms retry on a PR-creation event', () => {
		expect(
			classifyPullRequestRefreshAction(
				toolCall({ command: 'gh pr create --fill' }),
				false,
			),
		).toEqual({ kind: 'mark-created' });
	});

	test('requests an immediate retry when a PR URL appears', () => {
		expect(
			classifyPullRequestRefreshAction(
				toolResult('https://github.com/acme/app/pull/12'),
				false,
			),
		).toEqual({ createdPr: true, kind: 'refresh' });
	});

	test('resets arming when a turn starts', () => {
		expect(
			classifyPullRequestRefreshAction(status('starting', 'idle'), true),
		).toEqual({ kind: 'reset' });
		expect(
			classifyPullRequestRefreshAction(status('streaming', 'starting'), true),
		).toEqual({ kind: 'reset' });
	});

	test('requests a plain refresh at turn end when no PR was created', () => {
		expect(
			classifyPullRequestRefreshAction(status('idle', 'streaming'), false),
		).toEqual({ createdPr: false, kind: 'refresh' });
	});

	test('carries the created flag into the turn-end refresh', () => {
		expect(
			classifyPullRequestRefreshAction(status('idle', 'starting'), true),
		).toEqual({ createdPr: true, kind: 'refresh' });
	});

	test('does nothing for an idle event that did not follow a turn', () => {
		expect(
			classifyPullRequestRefreshAction(status('idle', 'idle'), true),
		).toEqual({ kind: 'none' });
	});

	test('does nothing for unrelated tool activity', () => {
		expect(
			classifyPullRequestRefreshAction(toolResult('all tests passed'), false),
		).toEqual({ kind: 'none' });
	});
});

describe('isFinishedTurnEvent', () => {
	test('is true when a turn transitions from streaming to idle', () => {
		expect(isFinishedTurnEvent(status('idle', 'streaming'))).toBe(true);
	});

	test('is true when a turn transitions from starting to idle', () => {
		expect(isFinishedTurnEvent(status('idle', 'starting'))).toBe(true);
	});

	test('is false for a turn start', () => {
		expect(isFinishedTurnEvent(status('streaming', 'starting'))).toBe(false);
	});

	test('is false for an idle event that did not follow a turn', () => {
		expect(isFinishedTurnEvent(status('idle', 'idle'))).toBe(false);
	});

	test('is false for non-status envelopes', () => {
		expect(isFinishedTurnEvent(toolResult('done'))).toBe(false);
	});
});
