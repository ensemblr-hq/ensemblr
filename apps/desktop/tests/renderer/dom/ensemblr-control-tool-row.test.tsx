// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import type { DynamicToolUIPart } from 'ai';
import { describe, expect, test } from 'vitest';
import { ChatToolCall } from '../../../src/renderer/components/chat-tool-call';
import { renderWithProviders } from '../support/dom';

/**
 * The app's own control rows now unfold onto a shaped body rather than a JSON
 * dump, and most of them answer a bare `{ ok: true }` and so have no body at
 * all. Both cases have to keep the actual call reachable — a shaped body is a
 * summary, and an empty one would otherwise strand the arguments.
 */

function controlPart(
	toolName: string,
	input: Record<string, unknown>,
	data: unknown,
): DynamicToolUIPart {
	return {
		input,
		output: { details: { data, ok: true }, text: JSON.stringify(data) },
		state: 'output-available',
		toolCallId: `${toolName}-1`,
		toolName,
		type: 'dynamic-tool',
	};
}

describe('control tool row DOM', () => {
	test('an op with no body still expands to its raw execution', () => {
		renderWithProviders(
			<ChatToolCall
				part={controlPart('ensemblr_close_tab', { chatTabId: 'tab-1' }, null)}
			/>,
		);

		const row = screen.getByRole('button', { name: 'Closed a tab' });
		expect(row).not.toBeDisabled();
		fireEvent.click(row);

		expect(
			screen.getByText('Raw execution: ensemblr_close_tab'),
		).toBeInTheDocument();
		expect(
			document.querySelector('[data-role="tool-raw-io"]'),
		).toBeInTheDocument();
	});

	test('names the tool canonically for a row an MCP client namespaced', () => {
		renderWithProviders(
			<ChatToolCall
				part={controlPart(
					'mcp__ensemblr__ensemblr_list_models',
					{},
					{
						allowedRuntimes: ['claude'],
						callerRuntime: 'claude',
						crossRuntimeDelegationEnabled: false,
						defaultModelId: 'opus[1m]',
						models: [],
					},
				)}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Listed models' }));

		expect(
			screen.getByText('Raw execution: ensemblr_list_models'),
		).toBeInTheDocument();
	});

	test('a shaped body renders beside the raw disclosure rather than instead of it', () => {
		renderWithProviders(
			<ChatToolCall
				part={controlPart(
					'ensemblr_wait_for_agents',
					{ mode: 'all' },
					{
						completed: [
							{
								agentSessionId: 'child-a',
								contextUsage: null,
								lastMessage: 'Done.',
								reportTruncated: false,
								signal: null,
								status: 'idle',
							},
						],
						pending: [],
						timedOut: false,
					},
				)}
			/>,
		);

		fireEvent.click(
			screen.getByRole('button', { name: 'Waited for sub-agents' }),
		);

		expect(screen.getByText('Settled')).toBeInTheDocument();
		expect(
			document.querySelector('[data-role="tool-raw-io"]'),
		).toBeInTheDocument();
	});

	test('an ordinary tool row carries no raw disclosure', () => {
		renderWithProviders(
			<ChatToolCall
				part={{
					input: { pattern: 'linear' },
					output: { details: null, text: 'one hit' },
					state: 'output-available',
					toolCallId: 'grep-1',
					toolName: 'grep',
					type: 'dynamic-tool',
				}}
			/>,
		);

		expect(document.querySelector('[data-role="tool-raw-io"]')).toBeNull();
	});
});
