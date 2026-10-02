import { useSetAtom } from 'jotai';
import { useEffect } from 'react';

import {
	reduceTerminalInputActivity,
	subscribeTerminalInput,
} from '@/renderer/lib/terminal';
import type { TerminalInputEventDetail } from '@/renderer/types/terminal';
import type {
	TerminalLifecycleBroadcast,
	TerminalSessionSnapshot,
} from '@/shared/ipc/contracts/terminal';

import {
	activeTerminalIdsAtom,
	reduceTerminalActivitySnapshot,
	type TerminalActivitySnapshot,
	terminalActivitySnapshotsAtom,
} from './terminal-activity';

type ActiveTerminalSetter = (
	updater: (previous: ReadonlySet<string>) => ReadonlySet<string>,
) => void;

type SnapshotSetter = (
	updater: (
		previous: Record<string, TerminalActivitySnapshot>,
	) => Record<string, TerminalActivitySnapshot>,
) => void;

/** Per-terminal bookkeeping owned by one mount of the watcher. */
interface ActivityTracking {
	/** Command line typed so far, per interactive terminal. */
	commandBuffers: Map<string, string>;
	/** Interactive terminals whose submitted command we are watching output for. */
	commandOutputTerminalIds: Set<string>;
	/** Pending idle timers that retire a terminal from the active set. */
	timers: Map<string, ReturnType<typeof setTimeout>>;
}

/**
 * The window between asking for the cross-workspace listing and its reply. The
 * listing describes an older moment, so broadcasts that land meanwhile are held
 * here and replayed on top of it — otherwise a session that started or ended
 * mid-flight is restored as a stale entry no later broadcast would clear.
 */
interface SeedingWindow {
	closed: boolean;
	pendingSessions: Map<string, TerminalSessionSnapshot>;
}

const NO_ACTIVE_TERMINALS: ReadonlySet<string> = new Set<string>();

const TERMINAL_OUTPUT_ACTIVITY_IDLE_MS = 1600;

/** Builds the empty per-mount tracking state. */
function createActivityTracking(): ActivityTracking {
	return {
		commandBuffers: new Map(),
		commandOutputTerminalIds: new Set(),
		timers: new Map(),
	};
}

/** Drops a terminal from the active-output set and cancels its idle timer. */
function clearTerminalActivity(
	terminalId: string,
	tracking: ActivityTracking,
	setActiveTerminalIds: ActiveTerminalSetter,
): void {
	const timer = tracking.timers.get(terminalId);
	if (timer) {
		clearTimeout(timer);
		tracking.timers.delete(terminalId);
	}
	setActiveTerminalIds((previous) => {
		if (!previous.has(terminalId)) {
			return previous;
		}
		const next = new Set(previous);
		next.delete(terminalId);
		return next;
	});
}

/**
 * Stops watching a terminal's command altogether, so later output no longer
 * counts as activity until the user submits another command.
 */
function stopWatchingCommand(
	terminalId: string,
	tracking: ActivityTracking,
	setActiveTerminalIds: ActiveTerminalSetter,
): void {
	tracking.commandOutputTerminalIds.delete(terminalId);
	clearTerminalActivity(terminalId, tracking, setActiveTerminalIds);
}

/** Marks a terminal active until output has been quiet for the idle window. */
function markTerminalActive(
	terminalId: string,
	tracking: ActivityTracking,
	setActiveTerminalIds: ActiveTerminalSetter,
): void {
	setActiveTerminalIds((previous) => {
		if (previous.has(terminalId)) {
			return previous;
		}
		return new Set(previous).add(terminalId);
	});

	const previousTimer = tracking.timers.get(terminalId);
	if (previousTimer) {
		clearTimeout(previousTimer);
	}
	tracking.timers.set(
		terminalId,
		setTimeout(() => {
			clearTerminalActivity(terminalId, tracking, setActiveTerminalIds);
		}, TERMINAL_OUTPUT_ACTIVITY_IDLE_MS),
	);
}

/**
 * Forgets everything this mount was watching, the shared active-id set
 * included. That set outlives the hook, so leaving ids in it would strand a
 * badge: the idle timers that would have retired them are cancelled here, and
 * the next mount has no record of which commands were running.
 */
function resetActivityTracking(
	tracking: ActivityTracking,
	setActiveTerminalIds: ActiveTerminalSetter,
): void {
	for (const timer of tracking.timers.values()) {
		clearTimeout(timer);
	}
	tracking.timers.clear();
	tracking.commandBuffers.clear();
	tracking.commandOutputTerminalIds.clear();
	setActiveTerminalIds((previous) =>
		previous.size === 0 ? previous : NO_ACTIVE_TERMINALS,
	);
}

/**
 * Replaces the activity map with the main process's cross-workspace listing,
 * replayed under the broadcasts that arrived while it was in flight. Replacing
 * rather than merging is what clears entries a previous mount left behind:
 * broadcasts sent while no watcher was subscribed are gone, so anything the
 * listing omits is no longer live. Best-effort — a missing bridge or a failed
 * listing leaves the map to be hydrated by lifecycle broadcasts alone.
 * @param seeding - Window collecting broadcasts until the listing is answered.
 * @param isCancelled - Reports whether the owning effect has since torn down.
 * @param setSnapshots - Writes the reconciled activity map.
 */
async function seedTerminalActivity(
	seeding: SeedingWindow,
	isCancelled: () => boolean,
	setSnapshots: SnapshotSetter,
): Promise<void> {
	const result = await window.ensemblr
		?.listTerminalSessions({})
		.catch(() => null);

	seeding.closed = true;
	const pending = Array.from(seeding.pendingSessions.values());
	seeding.pendingSessions.clear();

	if (!result || isCancelled()) {
		return;
	}

	const empty: Record<string, TerminalActivitySnapshot> = {};
	const listed = result.sessions.reduce(
		(snapshots, session) => reduceTerminalActivitySnapshot(snapshots, session),
		empty,
	);
	const reconciled = pending.reduce(
		(snapshots, session) => reduceTerminalActivitySnapshot(snapshots, session),
		listed,
	);
	setSnapshots(() => reconciled);
}

/**
 * Builds the lifecycle listener: folds every broadcast into the activity map,
 * holds it for the seed while the listing is in flight, and stops watching a
 * session the moment it is no longer running.
 * @param seeding - Window collecting broadcasts until the listing is answered.
 * @param tracking - Per-mount terminal bookkeeping.
 * @param setActiveTerminalIds - Writes the shared active-terminal set.
 * @param setSnapshots - Writes the activity map.
 * @returns The listener to hand to `onTerminalLifecycle`.
 */
function createLifecycleListener(
	seeding: SeedingWindow,
	tracking: ActivityTracking,
	setActiveTerminalIds: ActiveTerminalSetter,
	setSnapshots: SnapshotSetter,
): (event: TerminalLifecycleBroadcast) => void {
	return (event) => {
		if (!seeding.closed) {
			seeding.pendingSessions.set(event.terminalId, event.session);
		}
		setSnapshots((previous) =>
			reduceTerminalActivitySnapshot(previous, event.session),
		);
		if (event.session.status !== 'running') {
			tracking.commandBuffers.delete(event.terminalId);
			stopWatchingCommand(event.terminalId, tracking, setActiveTerminalIds);
		}
	};
}

/**
 * Builds the keystroke listener that decides whether an interactive terminal's
 * output belongs to a command the user submitted.
 * @param tracking - Per-mount terminal bookkeeping.
 * @param setActiveTerminalIds - Writes the shared active-terminal set.
 * @returns The listener to hand to `subscribeTerminalInput`.
 */
function createInputListener(
	tracking: ActivityTracking,
	setActiveTerminalIds: ActiveTerminalSetter,
): (detail: TerminalInputEventDetail) => void {
	return ({ data, terminalId }) => {
		const result = reduceTerminalInputActivity(
			tracking.commandBuffers.get(terminalId) ?? '',
			data,
		);
		if (result.interrupted) {
			tracking.commandBuffers.delete(terminalId);
			stopWatchingCommand(terminalId, tracking, setActiveTerminalIds);
			return;
		}
		tracking.commandBuffers.set(terminalId, result.nextBuffer);
		if (result.commandSubmitted) {
			tracking.commandOutputTerminalIds.add(terminalId);
			return;
		}
		// A keystroke while output is still streaming is type-ahead into a
		// running command, not a fresh prompt line: keep tracking so the
		// command's real output still counts as activity.
		if (tracking.timers.has(terminalId)) {
			return;
		}
		stopWatchingCommand(terminalId, tracking, setActiveTerminalIds);
	};
}

/**
 * Tracks terminal activity for every workspace at once: the live sessions the
 * main process reports and, for interactive terminals, whether a command the
 * user submitted is still producing output.
 *
 * Mounted by the workbench frame rather than per workspace route, because only
 * the open workspace's route is mounted — tracking there made a sidebar row
 * lose its running badge the moment the user navigated away. Terminal lifecycle
 * and output broadcasts carry their own `workspaceId`, so one subscription
 * covers every row; keystrokes only arrive from the mounted xterm, which is
 * enough to learn that a command started before the user left.
 *
 * The frame still unmounts for routes outside the workbench shell (settings,
 * onboarding, a route boundary), so both the teardown and the re-seed reconcile
 * the shared atoms rather than assuming they are only ever written here.
 */
export function useWatchTerminalActivity(): void {
	const setSnapshots = useSetAtom(terminalActivitySnapshotsAtom);
	const setActiveTerminalIds = useSetAtom(activeTerminalIdsAtom);

	useEffect(() => {
		let cancelled = false;
		const tracking = createActivityTracking();
		const seeding: SeedingWindow = {
			closed: false,
			pendingSessions: new Map(),
		};

		void seedTerminalActivity(seeding, () => cancelled, setSnapshots);

		const unsubscribeLifecycle = window.ensemblr?.onTerminalLifecycle(
			createLifecycleListener(
				seeding,
				tracking,
				setActiveTerminalIds,
				setSnapshots,
			),
		);

		const unsubscribeOutput = window.ensemblr?.onTerminalOutput((event) => {
			if (tracking.commandOutputTerminalIds.has(event.terminalId)) {
				markTerminalActive(event.terminalId, tracking, setActiveTerminalIds);
			}
		});

		const unsubscribeInput = subscribeTerminalInput(
			createInputListener(tracking, setActiveTerminalIds),
		);

		return () => {
			cancelled = true;
			unsubscribeLifecycle?.();
			unsubscribeOutput?.();
			unsubscribeInput();
			resetActivityTracking(tracking, setActiveTerminalIds);
		};
	}, [setActiveTerminalIds, setSnapshots]);
}
