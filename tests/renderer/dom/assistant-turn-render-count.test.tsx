// @vitest-environment happy-dom

/**
 * A live assistant turn re-renders on every streamed delta, because the
 * projector hands it a new `parts` array each time. The rows above the streaming
 * tail are settled tool calls, and there was no memo boundary between the turn
 * and their subtrees — so a turn that had already made forty tool calls
 * reconciled forty collapsible rows, chips and badges per frame, at a cost
 * linear in exactly the quantity a long agent run grows.
 *
 * `ToolRow` now carries that boundary. The rows between it and the turn
 * deliberately do not: `groupSubagentActivity` and `foldTaskPlanRuns` allocate a
 * fresh node object per part per fold, so nothing above `ToolRow` has a stable
 * prop to compare, and a memo placed there would never hold.
 *
 * This counts renders of the collapsible each settled row draws rather than
 * timing them, because that is the quantity the fix changes — the audit measured
 * 40 of 40 per delta before it.
 */

import type { UIMessage } from 'ai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ChatAssistantTurn } from '@/renderer/components/chat-assistant-turn';
import { renderWithProviders } from '../support/dom';

/** How many times the collapsible that wraps a settled tool row has rendered. */
let collapsibleRenders = 0;

vi.mock('@/renderer/components/tool-collapsible', () => ({
	ToolCollapsible: ({ children }: { children?: ReactNode }) => {
		collapsibleRenders += 1;
		return <div data-testid='tool-collapsible'>{children}</div>;
	},
}));

/**
 * Builds a settled `dynamic-tool` part, the shape a completed tool call takes
 * once its result has landed.
 * @param index - Distinguishes one call from the next
 * @returns One settled tool part
 */
function settledToolPart(index: number): UIMessage['parts'][number] {
	return {
		input: { command: `echo ${index}` },
		output: { text: `done ${index}` },
		state: 'output-available',
		toolCallId: `call-${index}`,
		toolName: 'Bash',
		type: 'dynamic-tool',
	} as unknown as UIMessage['parts'][number];
}

/**
 * The settled parts every turn below draws from. Built once, because the
 * projector preserves a settled part's object identity across folds and the
 * memo under test is what that identity buys — rebuilding them per render would
 * test a projector the app does not have.
 */
const SETTLED_PARTS = Array.from({ length: 80 }, (_, index) =>
	settledToolPart(index),
);

/**
 * Builds the live turn: a run of settled tool calls followed by the streaming
 * text tail, which is what grows between renders.
 * @param toolCount - How many settled tool calls precede the tail
 * @param tail - The streaming answer text so far
 * @returns The message the timeline would hand the turn
 */
function liveTurn(toolCount: number, tail: string): UIMessage {
	return {
		id: 'turn-1',
		parts: [
			...SETTLED_PARTS.slice(0, toolCount),
			{ state: 'streaming', text: tail, type: 'text' },
		],
		role: 'assistant',
	} as unknown as UIMessage;
}

const TIMING = { endMs: null, startMs: 0 };

describe('settled tool rows inside a streaming turn', () => {
	beforeEach(() => {
		collapsibleRenders = 0;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	test('do not re-render when the streaming tail grows', () => {
		const { rerender } = renderWithProviders(
			<ChatAssistantTurn
				isStreaming
				message={liveTurn(40, 'The')}
				timing={TIMING}
			/>,
		);
		expect(collapsibleRenders).toBe(40);

		collapsibleRenders = 0;
		for (const tail of ['The answer', 'The answer is', 'The answer is 4']) {
			rerender(
				<ChatAssistantTurn
					isStreaming
					message={liveTurn(40, tail)}
					timing={TIMING}
				/>,
			);
		}
		expect(collapsibleRenders).toBe(0);
	});

	test('cost of a delta does not grow with the number of settled rows', () => {
		const { rerender } = renderWithProviders(
			<ChatAssistantTurn
				isStreaming
				message={liveTurn(80, 'a')}
				timing={TIMING}
			/>,
		);
		collapsibleRenders = 0;
		rerender(
			<ChatAssistantTurn
				isStreaming
				message={liveTurn(80, 'ab')}
				timing={TIMING}
			/>,
		);
		expect(collapsibleRenders).toBe(0);
	});

	test('a newly arrived tool call still renders its row', () => {
		const { rerender } = renderWithProviders(
			<ChatAssistantTurn
				isStreaming
				message={liveTurn(3, 'a')}
				timing={TIMING}
			/>,
		);
		collapsibleRenders = 0;
		rerender(
			<ChatAssistantTurn
				isStreaming
				message={liveTurn(4, 'a')}
				timing={TIMING}
			/>,
		);
		expect(collapsibleRenders).toBe(1);
	});
});
