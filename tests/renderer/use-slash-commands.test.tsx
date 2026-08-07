// @vitest-environment happy-dom

/**
 * The slash menu belongs to whichever runtime would handle the submit. Serving a
 * Claude Code chat pi's commands is the bug this covers.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { useSlashCommands } from '../../src/renderer/hooks/workbench-shell/composer/use-slash-commands';
import type { ListAgentProviderSlashCommandsResult } from '../../src/shared/ipc/contracts/agent-provider';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

const CLAUDE_COMMANDS: ListAgentProviderSlashCommandsResult = {
	commands: [
		{ autoSubmit: false, command: 'security-review', description: 'Audit' },
		{ autoSubmit: false, command: 'code-review', description: 'Review' },
	],
	error: null,
	source: 'runtime',
};

/** Renders the hook with the slash menu shut, so the caller can open it. */
function renderSlashCommandsClosed(
	provider: 'claude' | 'pi' = 'claude',
	result: ListAgentProviderSlashCommandsResult = CLAUDE_COMMANDS,
) {
	return renderSlashCommands(provider, result, false);
}

/** Renders the hook over a stub bridge, returning the recorded bridge calls. */
function renderSlashCommands(
	provider: 'claude' | 'pi',
	result: ListAgentProviderSlashCommandsResult = CLAUDE_COMMANDS,
	menuOpen = true,
) {
	const listAgentProviderSlashCommands = vi.fn(async () => result);
	installEnsemblrApi({ listAgentProviderSlashCommands });
	const client = createTestQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);

	return {
		listAgentProviderSlashCommands,
		...renderHook(
			({ menuOpen: open }: { menuOpen: boolean }) =>
				useSlashCommands(provider, '/workspaces/demo', open),
			{ initialProps: { menuOpen }, wrapper },
		),
	};
}

afterEach(() => {
	clearEnsemblrApi();
});

// Asking a runtime for its commands starts a child process, so a composer that
// never opens the slash menu must never pay for one.
test('asks nothing until the slash menu is first opened', async () => {
	const { listAgentProviderSlashCommands, rerender } =
		renderSlashCommandsClosed();

	await waitFor(() =>
		expect(listAgentProviderSlashCommands).not.toHaveBeenCalled(),
	);

	rerender({ menuOpen: true });

	await waitFor(() =>
		expect(listAgentProviderSlashCommands).toHaveBeenCalledTimes(1),
	);
});

test('keeps the catalogue after the menu closes again', async () => {
	const { listAgentProviderSlashCommands, rerender, result } =
		renderSlashCommandsClosed();

	rerender({ menuOpen: true });
	await waitFor(() => expect(result.current.commands).not.toEqual([]));

	rerender({ menuOpen: false });

	expect(result.current.commands.map((entry) => entry.command)).toEqual([
		'code-review',
		'security-review',
	]);
	expect(listAgentProviderSlashCommands).toHaveBeenCalledTimes(1);
});

test('asks the runtime the composer is currently speaking for', async () => {
	const { listAgentProviderSlashCommands } = renderSlashCommands('claude');

	await waitFor(() =>
		expect(listAgentProviderSlashCommands).toHaveBeenCalledWith({
			cwd: '/workspaces/demo',
			provider: 'claude',
		}),
	);
});

test('returns the runtime commands rather than a vendored catalogue', async () => {
	const { result } = renderSlashCommands('claude');

	await waitFor(() =>
		expect(result.current.commands.map((entry) => entry.command)).toEqual([
			'code-review',
			'security-review',
		]),
	);
});

test('offers nothing for Claude Code when discovery fails', async () => {
	const { result } = renderSlashCommands('claude', {
		commands: [],
		error: 'No claude executable was found on your PATH.',
		source: 'runtime',
	});

	await waitFor(() => expect(result.current.commands).toEqual([]));
});

test("falls back to pi's vendored catalogue only for pi", async () => {
	const { result } = renderSlashCommands('pi', {
		commands: [],
		error: "Couldn't locate pi SDK package root.",
		source: 'static',
	});

	await waitFor(() =>
		expect(result.current.commands.map((entry) => entry.command)).toContain(
			'compact',
		),
	);
});

// Claude Code reports a skill once per discovery root, so the raw catalogue
// carries four identical `/code-review` entries the menu must not render.
test('collapses commands the runtime reported more than once', async () => {
	const { result } = renderSlashCommands('claude', {
		commands: [
			{ autoSubmit: false, command: 'code-review', description: 'Review' },
			{ autoSubmit: false, command: 'code-review', description: 'Review' },
			{ autoSubmit: false, command: 'code-review', description: 'Review' },
			{ autoSubmit: false, command: 'code-review', description: 'Review' },
		],
		error: null,
		source: 'runtime',
	});

	await waitFor(() =>
		expect(result.current.commands.map((entry) => entry.command)).toEqual([
			'code-review',
		]),
	);
});

// Discovery spawns a `claude` process, so the menu opens on an empty list. It
// must not claim nothing matched before the runtime has answered.
test('reports discovery as loading until the runtime answers', async () => {
	const { rerender, result } = renderSlashCommandsClosed();

	expect(result.current.loading).toBe(false);

	rerender({ menuOpen: true });
	expect(result.current.loading).toBe(true);

	await waitFor(() => expect(result.current.loading).toBe(false));
	expect(result.current.commands).not.toEqual([]);
});

test('stops reporting loading once discovery comes back empty', async () => {
	const { result } = renderSlashCommands('claude', {
		commands: [],
		error: 'No claude executable was found on your PATH.',
		source: 'runtime',
	});

	await waitFor(() => expect(result.current.loading).toBe(false));
	expect(result.current.commands).toEqual([]);
});
