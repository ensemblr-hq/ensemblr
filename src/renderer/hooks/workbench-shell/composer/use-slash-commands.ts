import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { agentProviderSlashCommandsQuery } from '@/renderer/api/ensemblr';

import { PI_STATIC_SLASH_COMMANDS } from '@/renderer/lib/workbench/pi-slash-commands';
import type { SlashCommandDescriptor } from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';

/** Nothing to offer until the runtime answers, for a runtime with no catalogue. */
const NO_SLASH_COMMANDS: readonly SlashCommandDescriptor[] = [];

/** Ranks slash commands in the default empty-query menu. */
function getSlashCommandRank(command: SlashCommandDescriptor): number {
	if (command.source === 'skill' && command.sourceScope === 'project') {
		return 0;
	}
	if (command.source === 'skill') {
		return 1;
	}
	if (command.source === 'extension') {
		return 2;
	}
	if (command.source === 'prompt') {
		return 3;
	}
	return 4;
}

/** Sorts prompt-invokable commands by desired default slash-menu groups. */
export function sortSlashCommands(
	commands: readonly SlashCommandDescriptor[],
): SlashCommandDescriptor[] {
	return [...commands].sort((left, right) => {
		const sourceDiff = getSlashCommandRank(left) - getSlashCommandRank(right);
		if (sourceDiff !== 0) {
			return sourceDiff;
		}
		return left.command.localeCompare(right.command);
	});
}

/**
 * Latches true the first time the slash menu opens and stays there, so the
 * catalogue is fetched once on demand and then kept for the rest of the chat
 * rather than being dropped and refetched every time the menu closes.
 * @param menuOpen - Whether the slash menu is open right now.
 * @returns Whether the menu has ever been opened.
 */
function useEverOpened(menuOpen: boolean): boolean {
	const [everOpened, setEverOpened] = useState(menuOpen);

	// Adjusted during render, not in an effect: an effect would commit one frame
	// with the query still disabled, so the first open would render an empty menu
	// before the fetch was even allowed to start.
	if (menuOpen && !everOpened) {
		setEverOpened(true);
	}

	return everOpened || menuOpen;
}

/**
 * Hook returning the slash commands of the runtime that would handle a submit.
 * Both runtimes answer over the same provider-parameterized channel, so a
 * Claude Code chat is never offered pi's commands and vice versa.
 *
 * Discovery is deferred until the slash menu is first opened. Asking a runtime
 * for its commands starts a child process — Claude Code's SDK spawns a real
 * `claude` — and doing that on every composer mount spends a process on a menu
 * most turns never open, and races the agent session the user actually asked
 * for. It also waits out the model list, so a new chat resolves its runtime
 * before asking rather than asking pi first and Claude Code a moment later.
 *
 * Only pi has a vendored fallback catalogue, used when its SDK cannot be
 * resolved (not installed yet, or installed in an unusual layout). Claude Code
 * has none: an empty menu is the honest answer when `claude` could not be asked,
 * where another runtime's commands would be a wrong one.
 * @param provider - Agent runtime the composer is currently speaking for.
 * @param workspaceCwd - Workspace directory used for project-local resources.
 * @param menuOpen - Whether the composer's slash menu is currently open.
 */
export function useSlashCommands(
	provider: AgentProviderId,
	workspaceCwd: string,
	menuOpen: boolean,
): readonly SlashCommandDescriptor[] {
	const everOpened = useEverOpened(menuOpen);
	const query = agentProviderSlashCommandsQuery(provider, workspaceCwd);
	const { data } = useQuery({
		...query,
		enabled: everOpened && query.enabled,
		retry: false,
	});

	return useMemo(() => {
		const fallback =
			provider === 'pi' ? PI_STATIC_SLASH_COMMANDS : NO_SLASH_COMMANDS;
		if (!data) {
			return sortSlashCommands(fallback);
		}
		if (data.source !== 'runtime' && data.commands.length === 0) {
			return sortSlashCommands(fallback);
		}
		return sortSlashCommands(
			data.commands.map((entry) => ({
				autoSubmit: entry.autoSubmit,
				command: entry.command,
				description: entry.description,
				source: entry.source,
				sourceScope: entry.sourceScope,
			})),
		);
	}, [data, provider]);
}
