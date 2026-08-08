// @vitest-environment happy-dom

import { fireEvent } from '@testing-library/react';
import type { UIMessage } from 'ai';
import { describe, expect, test } from 'vitest';

import { ChatAssistantTurn } from '../../../src/renderer/components/chat-assistant-turn';
import { renderWithProviders } from '../support/dom';

const REPORT = 'What went well: every sub-agent returned a usable report.';

const textPart = (text: string) =>
	({ state: 'done', text, type: 'text' }) as UIMessage['parts'][number];

const reasoningPart = (text: string) =>
	({ state: 'done', text, type: 'reasoning' }) as UIMessage['parts'][number];

const toolPart = (toolName: string, input: Record<string, unknown> = {}) =>
	({
		input,
		output: { details: null, text: 'ok' },
		state: 'output-available',
		toolCallId: `call-${toolName}`,
		toolName,
		type: 'dynamic-tool',
	}) as unknown as UIMessage['parts'][number];

const turn = (parts: UIMessage['parts']) => (
	<ChatAssistantTurn
		isStreaming={false}
		message={{ id: 'm1', parts, role: 'assistant' } as UIMessage}
		timing={{ endMs: 2_000, startMs: 1_000 }}
	/>
);

describe('ChatAssistantTurn', () => {
	// The reported bug: the orchestrator wrote its report, filed the session
	// summary, then signed off with a pointer. The summary call broke the trailing
	// text run, so the report rendered muted inside the collapsed activity row and
	// only "Done." stayed visible.
	test('keeps a report visible when a bookkeeping call follows it', () => {
		const { container } = renderWithProviders(
			turn([
				toolPart('bash', { command: 'ls' }),
				textPart(REPORT),
				toolPart('ensemblr_set_summary', {
					summary: '# Report',
					title: 'Astro',
				}),
				textPart('Done.'),
			]),
		);

		const answer = container.querySelector('.text-sm');
		expect(answer?.textContent).toContain(REPORT);
		expect(answer?.textContent).toContain('Done.');
	});

	test('renders no row for a successful bookkeeping call', () => {
		const { queryByText } = renderWithProviders(
			turn([
				toolPart('ensemblr_set_name', { name: 'Astro conversion' }),
				textPart('Named the tab and finished.'),
			]),
		);

		expect(queryByText(/ensemblr_set_name/)).toBeNull();
		expect(queryByText(/1 tool call/)).toBeNull();
	});

	test('titles a visible control call by its action once expanded', () => {
		const { container, getByRole } = renderWithProviders(
			turn([
				toolPart('ensemblr_start_conversation', { title: 'Astro audit' }),
				textPart('Spawned it.'),
			]),
		);

		fireEvent.click(getByRole('button', { expanded: false }));

		expect(container.textContent).toContain('Started a sub-agent: Astro audit');
		expect(container.textContent).not.toContain('ensemblr_start_conversation');
	});

	// A wait blocks until its children settle, so while the turn is still working
	// the row must not claim the wait already finished.
	test('reads a still-running wait in the present participle', () => {
		const { container } = renderWithProviders(
			<ChatAssistantTurn
				isStreaming={true}
				message={
					{
						id: 'm1',
						parts: [
							{
								input: {},
								state: 'input-available',
								toolCallId: 'call-wait',
								toolName: 'ensemblr_wait_for_agents',
								type: 'dynamic-tool',
							},
						],
						role: 'assistant',
					} as unknown as UIMessage
				}
				timing={{ endMs: null, startMs: 1_000 }}
			/>,
		);

		expect(container.textContent).toContain('Waiting for sub-agents');
		expect(container.textContent).not.toContain('Waited for sub-agents');
	});

	// A runtime that redacts its reasoning ships the block's signature and no
	// prose. The row it used to get said "Thought" and opened onto nothing.
	test('drops a reasoning block that carries no prose', () => {
		const { container, queryByText } = renderWithProviders(
			turn([reasoningPart('   '), textPart('Done.')]),
		);

		expect(queryByText('Thought')).toBeNull();
		expect(queryByText(/1 message/)).toBeNull();
		expect(container.querySelector('[data-role="turn-summary"]')).toBeNull();
	});

	test('keeps a reasoning block that carries prose', () => {
		const { getByText } = renderWithProviders(
			turn([reasoningPart('Check the config first.'), textPart('Done.')]),
		);

		expect(getByText(/1 message/)).toBeTruthy();
	});

	test('still folds commentary that precedes a real tool call', () => {
		const { getByText } = renderWithProviders(
			turn([
				textPart('Let me check the config.'),
				toolPart('read', { path: 'next.config.ts' }),
				textPart('Config is empty.'),
			]),
		);

		expect(getByText(/1 tool call/)).toBeTruthy();
	});
});
