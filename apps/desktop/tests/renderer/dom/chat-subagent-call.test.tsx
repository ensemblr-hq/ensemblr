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

function runningToolPart(
	toolCallId: string,
	toolName: string,
	input: Record<string, unknown> = {},
): UIMessagePart {
	return {
		input,
		state: 'input-available',
		toolCallId,
		toolName,
		type: 'dynamic-tool',
	} satisfies ParentedDynamicToolUIPart as UIMessagePart;
}

function settledSkillPart(toolCallId: string, skill: string): UIMessagePart {
	return {
		input: { skill },
		output: { details: null, text: '# Skill body' },
		state: 'output-available',
		toolCallId,
		toolName: 'Skill',
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

function turnElement(parts: UIMessagePart[], isStreaming: boolean) {
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
	return (
		<ChatAssistantTurn
			isStreaming={isStreaming}
			message={message}
			timing={TIMING}
		/>
	);
}

function renderTurn(parts: UIMessagePart[], isStreaming = false) {
	return renderWithProviders(turnElement(parts, isStreaming));
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

	test('adds nothing of its own to a delegation still in flight', () => {
		renderTurn(
			[
				taskPart({ input: { subagent_type: 'Explore' }, toolCallId: 'task-1' }),
				childToolPart('call-1', 'Grep', 'task-1', { pattern: 'authGuard' }),
			],
			true,
		);

		const card = screen.getByRole('button', { name: 'Sub-agent: Explore' });

		expect(card).toBeEnabled();

		expandAll();

		const body = document.getElementById(
			card.getAttribute('aria-controls') ?? '',
		);
		const nested = body?.querySelector('[data-role="subagent-children"]');

		expect(
			within(nested as HTMLElement).getByText('Search'),
		).toBeInTheDocument();
		expect(body?.textContent).toBe(nested?.textContent);
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

describe('a delegation before its first nested row', () => {
	/** Reads the disclosure control of the row titled `title`, if it has one. */
	function disclosureOf(title: string): HTMLElement | null {
		const button = screen.getByText(title).closest('button');
		return button?.getAttribute('aria-controls') === null ? null : button;
	}

	test('keeps a running subagent expandable so its rows can be watched arriving', () => {
		renderTurn(
			[taskPart({ input: { subagent_type: 'Explore' }, toolCallId: 'task-1' })],
			true,
		);

		expect(disclosureOf('Sub-agent: Explore')).not.toBeNull();
	});

	test('says the delegate has reported nothing yet rather than opening on a blank panel', () => {
		renderTurn(
			[taskPart({ input: { subagent_type: 'Explore' }, toolCallId: 'task-1' })],
			true,
		);

		expandAll();

		expect(screen.getByText('No steps reported yet.')).toBeInTheDocument();
		expect(
			document.querySelector('[data-role="subagent-children"]'),
		).toBeNull();
	});

	test('keeps the card once the delegation settles having produced nothing', () => {
		renderTurn([taskPart({ report: 'Found nothing.', toolCallId: 'task-1' })]);

		expandAll();

		expect(screen.getByText('Reported no steps.')).toBeInTheDocument();
		expect(screen.getByText('Found nothing.')).toBeInTheDocument();
	});

	test('holds an opened disclosure across the settle that produced no rows', () => {
		const { rerender } = renderWithProviders(
			turnElement(
				[
					taskPart({
						input: { subagent_type: 'Explore' },
						toolCallId: 'task-1',
					}),
				],
				true,
			),
		);

		expandAll();
		expect(screen.getByText('No steps reported yet.')).toBeInTheDocument();

		rerender(
			turnElement(
				[
					taskPart({
						input: { subagent_type: 'Explore' },
						report: 'Found nothing.',
						toolCallId: 'task-1',
					}),
				],
				false,
			),
		);

		expect(
			screen.getByText('Sub-agent: Explore').closest('button'),
		).toHaveAttribute('aria-expanded', 'true');
		expect(screen.getByText('Found nothing.')).toBeInTheDocument();
	});

	test('leaves a running skill inert until a nested row claims it, since a skill load opens no sub-context', () => {
		renderTurn(
			[runningToolPart('skill-1', 'Skill', { skill: 'code-review' })],
			true,
		);

		expect(disclosureOf('Skill: code-review')).toBeNull();
	});

	test('gives a skill the card once it turns out to have run a sub-agent', () => {
		renderTurn(
			[
				runningToolPart('skill-1', 'Skill', { skill: 'code-review' }),
				childToolPart('call-1', 'Grep', 'skill-1', { pattern: 'authGuard' }),
			],
			true,
		);

		expect(disclosureOf('Skill: code-review')).not.toBeNull();
	});

	test('leaves an async launch out of the card, whose work reports nowhere beneath it', () => {
		renderTurn(
			[
				runningToolPart('agent-1', 'Agent', {
					prompt: 'Investigate the flake',
					run_in_background: true,
				}),
			],
			true,
		);

		expandAll();

		expect(screen.queryByText('No steps reported yet.')).toBeNull();
		expect(
			document.querySelector('[data-role="subagent-awaiting"]'),
		).toBeNull();
	});

	test('drops the empty-state line once the first nested row arrives', () => {
		renderTurn(
			[
				taskPart({ input: { subagent_type: 'Explore' }, toolCallId: 'task-1' }),
				childToolPart('call-1', 'Grep', 'task-1', { pattern: 'authGuard' }),
			],
			true,
		);

		expandAll();

		expect(
			screen.queryByText('No steps reported yet.'),
		).not.toBeInTheDocument();
		expect(
			document.querySelector('[data-role="subagent-children"]'),
		).not.toBeNull();
	});

	test('leaves an ordinary running tool inert, whose pulse already says it all', () => {
		renderTurn(
			[runningToolPart('call-1', 'Grep', { pattern: 'authGuard' })],
			true,
		);

		expect(disclosureOf('Search')).toBeNull();
	});

	test('leaves a settled skill that owned nothing inert', () => {
		renderTurn([settledSkillPart('skill-1', 'code-review')]);

		expect(disclosureOf('Skill: code-review')).toBeNull();
	});
});
