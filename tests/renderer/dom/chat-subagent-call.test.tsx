// @vitest-environment happy-dom

import { fireEvent, screen, within } from '@testing-library/react';
import type { UIMessage } from 'ai';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

vi.mock('../../../src/renderer/lib/code/highlighter', () => ({
	highlightCode: () => null,
}));

import { ChatAssistantTurn } from '../../../src/renderer/components/chat-assistant-turn';
import type {
	ParentedDynamicToolUIPart,
	ParentedUIMessagePart,
	UIMessagePart,
} from '../../../src/renderer/types/agent-timeline';
import { renderWithProviders } from '../support/dom';

const TIMING = { endMs: 1_000, startMs: 0 };

function taskPart(overrides: {
	input?: Record<string, unknown>;
	report?: string;
	toolCallId: string;
}): UIMessagePart {
	const settled =
		overrides.report === undefined
			? { input: overrides.input ?? {}, state: 'input-available' as const }
			: {
					input: overrides.input ?? {},
					output: { details: null, text: overrides.report },
					state: 'output-available' as const,
				};
	return {
		...settled,
		toolCallId: overrides.toolCallId,
		toolName: 'Task',
		type: 'dynamic-tool',
	} satisfies ParentedDynamicToolUIPart as UIMessagePart;
}

function childToolPart(
	toolCallId: string,
	toolName: string,
	parentToolCallId: string,
	input: Record<string, unknown> = {},
): UIMessagePart {
	return {
		input,
		parentToolCallId,
		state: 'input-available',
		toolCallId,
		toolName,
		type: 'dynamic-tool',
	} satisfies ParentedDynamicToolUIPart as UIMessagePart;
}

function childTextPart(text: string, parentToolCallId: string): UIMessagePart {
	return {
		parentToolCallId,
		state: 'done',
		text,
		type: 'text',
	} satisfies ParentedUIMessagePart as UIMessagePart;
}

function childReasoningPart(
	text: string,
	parentToolCallId: string,
): UIMessagePart {
	return {
		parentToolCallId,
		state: 'done',
		text,
		type: 'reasoning',
	} satisfies ParentedUIMessagePart as UIMessagePart;
}

function renderTurn(parts: UIMessagePart[], isStreaming = false) {
	const message: UIMessage = {
		id: 'msg-1',
		metadata: {
			firstEventAt: '2026-06-08T12:00:00.000Z',
			lastEventAt: '2026-06-08T12:00:10.000Z',
			lastOrdinal: 10,
			turnId: 'turn-1',
		},
		parts,
		role: 'assistant',
	};
	return renderWithProviders(
		<ChatAssistantTurn
			isStreaming={isStreaming}
			message={message}
			timing={TIMING}
		/>,
	);
}

/** Opens every collapsed disclosure the turn rendered, outermost first. */
function expandAll(): void {
	for (let pass = 0; pass < 4; pass += 1) {
		const collapsed = screen
			.queryAllByRole('button', { expanded: false })
			.filter((button) => button.getAttribute('aria-controls') !== null);
		if (collapsed.length === 0) {
			return;
		}
		for (const button of collapsed) {
			fireEvent.click(button);
		}
	}
}

describe('ChatSubagentCall', () => {
	test('titles the row with the subagent type and previews the task', () => {
		renderTurn([
			taskPart({
				input: { description: 'find the auth guard', subagent_type: 'Explore' },
				toolCallId: 'task-1',
			}),
		]);

		expect(screen.getByText('Sub-agent: Explore')).toBeInTheDocument();
		expect(screen.getByText('find the auth guard')).toBeInTheDocument();
	});

	test('falls back to the generic title when no subagent type was named', () => {
		renderTurn([
			taskPart({ input: { description: 'poke around' }, toolCallId: 'task-1' }),
		]);

		expect(screen.getByText('Sub-agent')).toBeInTheDocument();
	});

	test('nests the subagent tool calls inside the card, not beside it', () => {
		renderTurn([
			taskPart({
				input: { description: 'find the auth guard', subagent_type: 'Explore' },
				report: 'Found it in src/main/auth.ts',
				toolCallId: 'task-1',
			}),
			childToolPart('call-1', 'Grep', 'task-1', { pattern: 'authGuard' }),
		]);

		expandAll();

		const nested = document.querySelector('[data-role="subagent-children"]');
		expect(nested).not.toBeNull();
		expect(
			within(nested as HTMLElement).getByText('Search'),
		).toBeInTheDocument();
	});

	test('counts the nested tool calls on the card header', () => {
		renderTurn([
			taskPart({
				input: { subagent_type: 'Explore' },
				report: 'done',
				toolCallId: 'task-1',
			}),
			childToolPart('call-1', 'Grep', 'task-1'),
			childToolPart('call-2', 'Read', 'task-1'),
		]);

		expect(screen.getByText('2 tool calls')).toBeInTheDocument();
	});

	test('counts only tool calls, not the prose the subagent forwarded', () => {
		renderTurn([
			taskPart({
				input: { subagent_type: 'Explore' },
				report: 'done',
				toolCallId: 'task-1',
			}),
			childTextPart('narrating progress', 'task-1'),
			childReasoningPart('weighing it up', 'task-1'),
			childToolPart('call-1', 'Grep', 'task-1'),
		]);

		expect(screen.getByText('1 tool call')).toBeInTheDocument();
		expect(screen.queryByText('3 tool calls')).toBeNull();
	});

	test('drops the badge for a delegation that ran no tools at all', () => {
		renderTurn([
			taskPart({
				input: { subagent_type: 'Explore' },
				report: 'done',
				toolCallId: 'task-1',
			}),
			childTextPart('just thinking out loud', 'task-1'),
		]);

		expandAll();

		expect(screen.queryByText(/tool calls?$/)).toBeNull();
		expect(screen.getByText('just thinking out loud')).toBeInTheDocument();
	});

	test('renders the subagent report as markdown in the body', () => {
		renderTurn([
			taskPart({
				input: { subagent_type: 'Explore' },
				report: '# Report heading',
				toolCallId: 'task-1',
			}),
			childToolPart('call-1', 'Grep', 'task-1'),
		]);

		expandAll();

		expect(screen.getByText('Report heading')).toBeInTheDocument();
	});

	test('keeps the subagent report out of the turn answer', () => {
		renderTurn([
			taskPart({
				input: { subagent_type: 'Explore' },
				report: 'delegate report',
				toolCallId: 'task-1',
			}),
			childTextPart('the delegate signing off', 'task-1'),
		]);

		expandAll();

		const answer = screen.getByText('the delegate signing off');
		expect(answer.closest('[data-role="subagent-children"]')).not.toBeNull();
	});

	test('renders the subagent report once, not beside its own card body', () => {
		renderTurn([
			taskPart({
				input: { subagent_type: 'Explore' },
				report: 'the closing report',
				toolCallId: 'task-1',
			}),
			childToolPart('call-1', 'Grep', 'task-1'),
			childTextPart('the closing report', 'task-1'),
		]);

		expandAll();

		expect(screen.queryAllByText('the closing report')).toHaveLength(1);
	});

	test('still shows the report while the delegation is in flight', () => {
		renderTurn(
			[
				taskPart({ input: { subagent_type: 'Explore' }, toolCallId: 'task-1' }),
				childTextPart('partial thoughts', 'task-1'),
			],
			true,
		);

		expandAll();

		expect(screen.getByText('partial thoughts')).toBeInTheDocument();
	});

	test('renders an unlinked tool call flat, as before subagents nested', () => {
		renderTurn([
			{
				input: { pattern: 'authGuard' },
				state: 'input-available',
				toolCallId: 'call-1',
				toolName: 'Grep',
				type: 'dynamic-tool',
			} satisfies ParentedDynamicToolUIPart as UIMessagePart,
		]);

		expect(
			document.querySelector('[data-role="subagent-children"]'),
		).toBeNull();
		expect(screen.getByText('authGuard')).toBeInTheDocument();
	});
});
