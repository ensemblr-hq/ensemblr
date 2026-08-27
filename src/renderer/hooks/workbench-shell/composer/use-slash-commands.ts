import { type RefetchOptions, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
	agentProviderSlashCommandsQuery,
	canDiscoverSlashCommands,
} from '@/renderer/api/ensemblr';
import { hasCachedSlashCommands } from '@/renderer/api/ensemblr/slash-commands-cache';

import { PI_STATIC_SLASH_COMMANDS } from '@/renderer/lib/workbench/pi-slash-commands';
import { normalizeSlashCommands } from '@/renderer/lib/workbench/slash-command-order';
import type { SlashCommandDescriptor } from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';

/** Nothing to offer until the runtime answers, for a runtime with no catalogue. */
const NO_SLASH_COMMANDS: readonly SlashCommandDescriptor[] = [];

/**
 * How old a discovered catalogue may be before a deliberate look at it — the app
 * coming back from elsewhere, or the slash menu opening — revalidates it in the
 * background.
 *
 * Deliberately far shorter than the query's `staleTime`, which is sized so that
 * a composer *mount* does not spawn a discovery child. Skills are installed
 * outside the composer, so the moments the user turns back to it are exactly the
 * ones where the cached catalogue is most likely to be wrong.
 */
const REVALIDATE_AFTER_MS = 30_000;

/**
 * The same window, for a catalogue the runtime could not actually produce.
 *
 * A failed discovery still *resolves* — the query falls back to the cache and
 * carries the error alongside it — so it refreshes the age clock exactly like a
 * good answer does. Held to the short window, a machine with no `claude` on it
 * would re-spawn a doomed child every time its user came back to the app; this
 * keeps those re-probes on the query's own stale time instead.
 */
const FAILED_REVALIDATE_AFTER_MS = 5 * 60_000;

/**
 * How long the window must have been away before regaining focus counts as
 * turning back to the composer.
 *
 * `focus` fires on every return to the window, a native dialog closing and a
 * detour into DevTools included. Those are not trips to install a skill, and
 * without a floor under them an ordinary session spends a discovery child every
 * {@link REVALIDATE_AFTER_MS} for the whole time it is open.
 */
const MIN_AWAY_MS = 5_000;

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

/** What the revalidation triggers need to know about the query behind them. */
interface RevalidationSubject {
	/**
	 * Epoch milliseconds the held catalogue was discovered. Zero before anything
	 * has been held, which reads as arbitrarily old and is the right answer.
	 */
	discoveredAt: number;
	/**
	 * Whether the query may fetch at all. A disabled query still honours
	 * `refetch`, so this guard is what keeps deferred discovery deferred.
	 */
	enabled: boolean;
	/** Whether the held catalogue is one the runtime could not actually produce. */
	failed: boolean;
	refetch: (options: RefetchOptions) => Promise<unknown>;
}

/**
 * Revalidates the catalogue whenever the user turns back to it — the slash menu
 * opening, or the app coming back from somewhere else — and the held one has
 * aged past {@link REVALIDATE_AFTER_MS}.
 *
 * Without this a catalogue discovered once never refreshes for the life of the
 * window. `staleTime` only decides whether a *trigger* refetches, and this query
 * has none: the composer's observer stays mounted for the whole chat, and
 * `refetchOnWindowFocus` is off app-wide. A skill installed after the chat was
 * opened therefore stayed invisible in that workspace until the app relaunched,
 * while a workspace created afterwards picked it up immediately.
 *
 * Three gates keep this cheap, because discovery spawns a child process: the age
 * check, so repeated opens inside one window cost nothing; {@link MIN_AWAY_MS},
 * so a glance away from the app is not mistaken for a trip to install something;
 * and {@link FAILED_REVALIDATE_AFTER_MS}, so a runtime that cannot answer is not
 * re-asked at the pace of one that can. `cancelRefetch: false` keeps a first open
 * from tearing down the fetch the observer starts on its own mount, which would
 * spawn two discovery children for one look at the menu.
 * @param menuOpen - Whether the slash menu is open right now.
 * @param subject - The query the triggers revalidate, read fresh at trigger time.
 */
function useRevalidateWhenLookedAt(
	menuOpen: boolean,
	subject: RevalidationSubject,
): void {
	const latest = useRef(subject);
	useEffect(() => {
		latest.current = subject;
	});

	const revalidate = useCallback(() => {
		const { discoveredAt, enabled, failed, refetch } = latest.current;
		const minAge = failed ? FAILED_REVALIDATE_AFTER_MS : REVALIDATE_AFTER_MS;
		if (!enabled || Date.now() - discoveredAt < minAge) {
			return;
		}
		void refetch({ cancelRefetch: false });
	}, []);

	useEffect(() => {
		if (menuOpen) {
			revalidate();
		}
	}, [menuOpen, revalidate]);

	useEffect(() => {
		let awaySince = 0;
		const rememberDeparture = () => {
			awaySince = Date.now();
		};
		const revalidateIfBackFromSomewhere = () => {
			if (Date.now() - awaySince >= MIN_AWAY_MS) {
				revalidate();
			}
		};
		window.addEventListener('blur', rememberDeparture);
		window.addEventListener('focus', revalidateIfBackFromSomewhere);
		return () => {
			window.removeEventListener('blur', rememberDeparture);
			window.removeEventListener('focus', revalidateIfBackFromSomewhere);
		};
	}, [revalidate]);
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
 * Once discovery has answered, the catalogue is revalidated whenever the user
 * turns back to it — see {@link useRevalidateWhenLookedAt}, which is what keeps
 * a skill installed mid-session from staying invisible in this workspace.
 *
 * A refresh lands in the query, never under an open menu: `useStableWhileOpen`
 * holds whatever the menu is already showing, so an open that triggers a
 * revalidate still paints the catalogue from before it and the *next* open
 * paints the new one. Coming back to the app is therefore the trigger that
 * matters, because it fires while the menu is still shut. A skill installed
 * without ever leaving this window — in an Ensemblr terminal — has no such
 * trigger, so it surfaces on the second open rather than the first.
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
	const enabled =
		(everOpened || warmable) && canDiscoverSlashCommands(workspaceCwd);
	const { data, dataUpdatedAt, isFetching, refetch } = useQuery({
		...query,
		enabled,
		retry: false,
	});
	const discoveryFailed =
		data !== undefined && (data.source !== 'runtime' || data.error !== null);
	useRevalidateWhenLookedAt(menuOpen, {
		discoveredAt: dataUpdatedAt,
		enabled,
		failed: discoveryFailed,
		refetch,
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
