import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { agentProviderSlashCommandsQuery } from '@/renderer/api/ensemblr';
import { hasCachedSlashCommands } from '@/renderer/api/ensemblr/slash-commands-cache';

import { PI_STATIC_SLASH_COMMANDS } from '@/renderer/lib/workbench/pi-slash-commands';
import { normalizeSlashCommands } from '@/renderer/lib/workbench/slash-command-order';
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

/**
 * A catalogue plus whether it is a real discovery answer rather than the
 * vendored placeholder shown before one arrives.
 */
interface ResolvedCatalogue {
	commands: readonly SlashCommandDescriptor[];
	discovered: boolean;
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
 * Holds a discovered catalogue steady for as long as the menu is open, releasing
 * the newest one once it closes.
 *
 * A background revalidate that lands mid-typing would otherwise reorder the rows
 * under the keyboard highlight, and `Enter` on an `autoSubmit` command sends it
 * immediately — so a reorder between keystroke and `Enter` runs a command the
 * user never chose.
 *
 * Only a discovered catalogue is held. The placeholder shown before discovery
 * answers must always give way, and it is not always empty: pi's vendored
 * fallback carries a full catalogue, so latching on emptiness would pin those
 * static commands for the whole first open and hide the user's own skills until
 * they dismissed the menu and reopened it.
 * @param catalogue - The latest catalogue and where it came from.
 * @param menuOpen - Whether the slash menu is open right now.
 * @returns The catalogue the menu should render.
 */
function useStableWhileOpen(
	catalogue: ResolvedCatalogue,
	menuOpen: boolean,
): readonly SlashCommandDescriptor[] {
	const [held, setHeld] = useState(catalogue);

	if (held !== catalogue && (!menuOpen || !held.discovered)) {
		setHeld(catalogue);
		return catalogue.commands;
	}

	return menuOpen ? held.commands : catalogue.commands;
}

/**
 * Hook returning the slash commands of the runtime that would handle a submit.
 * Both runtimes answer over the same provider-parameterized channel, so a
 * Claude Code chat is never offered pi's commands and vice versa.
 *
 * Discovery is deferred until the slash menu is first opened, unless this
 * workspace already has a cached catalogue. Asking a runtime for its commands
 * starts a child process — Claude Code's SDK spawns a real `claude` — and doing
 * that on every composer mount spends a process on a menu most turns never open,
 * and races the agent session the user actually asked for.
 *
 * A cached workspace is exempt: it has something to paint immediately, so it is
 * worth one background refresh to keep it true. That refresh is a real cost, not
 * a free one — a cache written in an earlier session is past the stale time, so
 * the usual launch does spawn a child at composer mount without the user ever
 * typing `/`. It is bounded to one per runtime and workspace per stale window by
 * the query key, and a cache younger than the stale time spawns nothing at all.
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
	const warmable = useMemo(
		() => hasCachedSlashCommands(provider, workspaceCwd),
		[provider, workspaceCwd],
	);
	const query = agentProviderSlashCommandsQuery(provider, workspaceCwd);
	const { data, isFetching } = useQuery({
		...query,
		enabled: (everOpened || warmable) && query.enabled,
		retry: false,
	});

	// Memoized without `isFetching`: it flips twice per revalidate, and including
	// it would hand the menu a new array identity — and a full rescore — each time
	// even when the catalogue is byte-identical.
	const catalogue = useMemo<ResolvedCatalogue>(() => {
		const fallback =
			provider === 'pi' ? PI_STATIC_SLASH_COMMANDS : NO_SLASH_COMMANDS;
		if (!data || (data.source !== 'runtime' && data.commands.length === 0)) {
			return { commands: normalizeSlashCommands(fallback), discovered: false };
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
			discovered: true,
		};
	}, [data, provider]);

	return {
		commands: useStableWhileOpen(catalogue, menuOpen),
		loading: isFetching,
	};
}
