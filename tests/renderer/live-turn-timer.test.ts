/// <reference types="bun" />

import { describe, expect, test } from 'bun:test';

import type { UIMessage } from 'ai';

import { resolveLiveTurnStartMs } from '../../src/renderer/components/workbench-shell/conversation-panel/timeline/timeline';
import type { OptimisticPrompt } from '../../src/renderer/state/composer';

function userMessage(firstEventAt: string): UIMessage {
	return {
		id: `user-${firstEventAt}`,
		metadata: {
			firstEventAt,
			lastEventAt: firstEventAt,
			lastOrdinal: 0,
			turnId: 'turn-1',
		},
		parts: [{ state: 'done', text: 'hi', type: 'text' }],
		role: 'user',
	};
}

function optimistic(submittedAt: string): OptimisticPrompt {
	return {
		chatTabId: 'tab-1',
		id: `optimistic:${submittedAt}`,
		prompt: 'hi',
		submittedAt,
	};
}

describe('resolveLiveTurnStartMs', () => {
	test('prefers the most recent optimistic prompt submit time', () => {
		const start = resolveLiveTurnStartMs(
			[userMessage('2026-06-08T12:00:00.000Z')],
			[optimistic('2026-06-08T12:00:05.000Z')],
		);
		expect(start).toBe(Date.parse('2026-06-08T12:00:05.000Z'));
	});

	test('falls back to the trailing persisted user message timestamp', () => {
		const start = resolveLiveTurnStartMs(
			[userMessage('2026-06-08T12:00:00.000Z')],
			[],
		);
		expect(start).toBe(Date.parse('2026-06-08T12:00:00.000Z'));
	});

	test('returns null when no usable timestamp is available', () => {
		const bareUser: UIMessage = {
			id: 'u',
			parts: [{ state: 'done', text: 'hi', type: 'text' }],
			role: 'user',
		};
		expect(resolveLiveTurnStartMs([bareUser], [])).toBeNull();
		expect(resolveLiveTurnStartMs([], [])).toBeNull();
	});
});
