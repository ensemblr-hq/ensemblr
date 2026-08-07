import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { agentProviderSlashCommandsQuery } from '@/renderer/api/ensemblr';

import { PI_STATIC_SLASH_COMMANDS } from '@/renderer/lib/workbench/pi-slash-commands';
import type { SlashCommandDescriptor } from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';

/** Nothing to offer until the runtime answers, for a runtime with no catalogue. */
const NO_SLASH_COMMANDS: readonly SlashCommandDescriptor[] = [];

/** A runtime's slash catalogue plus whether discovery is still in flight. */
export interface SlashCommandCatalogue {
	commands: readonly SlashCommandDescriptor[];
	/** True while the runtime has been asked but has not answered yet. */
	loading: boolean;
}

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

/** Ranks a described command ahead of an otherwise equal bare one. */
function getDescriptionRank(command: SlashCommandDescriptor): number {
	return command.description.trim().length > 0 ? 0 : 1;
}

/** Orders commands by menu group, then by how much each says about itself. */
function compareSlashCommands(
	left: SlashCommandDescriptor,
	right: SlashCommandDescriptor,
): number {
	const sourceDiff = getSlashCommandRank(left) - getSlashCommandRank(right);
	if (sourceDiff !== 0) {
		return sourceDiff;
	}
	const descriptionDiff = getDescriptionRank(left) - getDescriptionRank(right);
	if (descriptionDiff !== 0) {
		return descriptionDiff;
	}
	return left.command.localeCompare(right.command);
}

/**
 * Sorts prompt-invokable commands into the default slash-menu groups and keeps
 * one entry per command name.
 *
 * A runtime can report the same command many times: Claude Code resolves a
 * skill once per discovery root it reaches, so a single `/code-review` arrives
 * four times, and pi reports a skill once per scope it is installed in. The
 * menu identifies a row by its command name, so repeats collide into one React
 * key and the highlight stops tracking the row under the pointer. Sorting first
 * means the surviving entry is the best-ranked, most descriptive one.
 * @param commands - Raw catalogue as the runtime reported it.
 * @returns Menu-ordered commands with repeated names removed.
 */
export function normalizeSlashCommands(
	commands: readonly SlashCommandDescriptor[],
): SlashCommandDescriptor[] {
	const byName = new Map<string, SlashCommandDescriptor>();
	for (const command of [...commands].sort(compareSlashCommands)) {
		if (!byName.has(command.command)) {
			byName.set(command.command, command);
		}
	}
	return [...byName.values()];
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
 * @returns The runtime's commands plus whether discovery is still running.
 */
export function useSlashCommands(
	provider: AgentProviderId,
	workspaceCwd: string,
	menuOpen: boolean,
): SlashCommandCatalogue {
	const everOpened = useEverOpened(menuOpen);
	const query = agentProviderSlashCommandsQuery(provider, workspaceCwd);
	const { data, isFetching } = useQuery({
		...query,
		enabled: everOpened && query.enabled,
		retry: false,
	});

	return useMemo(() => {
		const fallback =
			provider === 'pi' ? PI_STATIC_SLASH_COMMANDS : NO_SLASH_COMMANDS;
		if (!data || (data.source !== 'runtime' && data.commands.length === 0)) {
			return {
				commands: normalizeSlashCommands(fallback),
				loading: isFetching,
			};
		}
		return {
			commands: normalizeSlashCommands(
				data.commands.map((entry) => ({
					autoSubmit: entry.autoSubmit,
					command: entry.command,
					description: entry.description,
					source: entry.source,
					sourceScope: entry.sourceScope,
				})),
			),
			loading: isFetching,
		};
	}, [data, isFetching, provider]);
}
