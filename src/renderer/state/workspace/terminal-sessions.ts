import { useCallback, useEffect, useRef, useState } from 'react';
import type { TerminalInputEventDetail } from '@/renderer/lib/terminal/terminal-tabs';
import {
	reduceTerminalInputActivity,
	subscribeTerminalInput,
	upsertTerminalSession,
} from '@/renderer/lib/terminal/terminal-tabs';
import type {
	CreateTerminalSessionResult,
	TerminalSessionSnapshot,
} from '@/shared/ipc/contracts/terminal';

type ActiveTerminalSetter = (
	updater: (previous: ReadonlySet<string>) => ReadonlySet<string>,
) => void;

type ActivityTimers = Map<string, ReturnType<typeof setTimeout>>;

const TERMINAL_OUTPUT_ACTIVITY_IDLE_MS = 1600;

/** Live terminal sessions for one workspace plus create/close actions. */
interface WorkspaceTerminalSessionsState {
	/** Interactive terminal ids with recent output activity. */
	activeTerminalIds: ReadonlySet<string>;
	/** Kills the session and removes its tab from the dock. */
	closeTerminal: (terminalId: string) => Promise<void>;
	createTerminal: () => Promise<CreateTerminalSessionResult>;
	sessions: TerminalSessionSnapshot[];
}

/**
 * Relaunches the interactive dock terminals that were open when the app last
 * quit, seeding each with its persisted prior output. Called only for a fresh
 * dock (no live sessions); the main process offers each workspace's set once, so
 * a later remount finds nothing to restore. Best-effort — a missing bridge or a
 * failed relaunch simply skips that tab.
 * @param workspaceId - Workspace whose dock to restore.
 * @param isCancelled - Reports whether the owning effect has since torn down.
 * @param setSessions - Folds each relaunched session into dock state.
 */
async function restoreDockTerminals(
	workspaceId: string,
	isCancelled: () => boolean,
	setSessions: (
		updater: (previous: TerminalSessionSnapshot[]) => TerminalSessionSnapshot[],
	) => void,
): Promise<void> {
	const result = await window.ensemblr
		?.listRestorableTerminals({ workspaceId })
		.catch(() => null);

	if (!result || isCancelled()) {
		return;
	}

	for (const terminal of result.terminals) {
		// Relaunch serially: each spawn assembles a workspace environment that
		// allocates a port, so concurrent creates would race on allocation, and the
		// between-spawn cancel check halts a torn-down effect mid-restore.
		// react-doctor-disable-next-line -- Serial relaunch is intentional; see above.
		const created = await window.ensemblr
			?.createTerminalSession({
				restoredFromId: terminal.id,
				seedOutput: terminal.output,
				title: terminal.title,
				workspaceId,
			})
			.catch(() => null);

		if (isCancelled()) {
			return;
		}

		const session = created?.session;
		if (session) {
			setSessions((previous) => upsertTerminalSession(previous, session));
		}
	}
}

/** Clears every pending terminal-activity idle timer. */
function clearActivityTimers(activityTimers: ActivityTimers): void {
	for (const timer of activityTimers.values()) {
		clearTimeout(timer);
	}
	activityTimers.clear();
}

/** Removes a terminal from the active-output set and clears its idle timer. */
function removeActiveTerminal(
	terminalId: string,
	activityTimers: ActivityTimers,
	setActiveTerminalIds: ActiveTerminalSetter,
	trackedTerminalIds?: Set<string>,
): void {
	trackedTerminalIds?.delete(terminalId);
	const timer = activityTimers.get(terminalId);
	if (timer) {
		clearTimeout(timer);
		activityTimers.delete(terminalId);
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

/** Marks a terminal active until output has been quiet for the idle window. */
function markTerminalActive(
	terminalId: string,
	activityTimers: ActivityTimers,
	setActiveTerminalIds: ActiveTerminalSetter,
): void {
	setActiveTerminalIds((previous) => {
		if (previous.has(terminalId)) {
			return previous;
		}
		return new Set(previous).add(terminalId);
	});

	const previousTimer = activityTimers.get(terminalId);
	if (previousTimer) {
		clearTimeout(previousTimer);
	}
	const timer = setTimeout(() => {
		removeActiveTerminal(terminalId, activityTimers, setActiveTerminalIds);
	}, TERMINAL_OUTPUT_ACTIVITY_IDLE_MS);
	activityTimers.set(terminalId, timer);
}

/**
 * Tracks the live terminal sessions of a workspace: seeds from the main
 * process list, then folds lifecycle broadcasts into local state.
 * @param workspaceId - Workspace whose sessions to track.
 * @returns Session list plus create/kill actions.
 */
export function useWorkspaceTerminalSessions(
	workspaceId: string,
): WorkspaceTerminalSessionsState {
	const [sessions, setSessions] = useState<TerminalSessionSnapshot[]>([]);
	const [activeTerminalIds, setActiveTerminalIds] = useState<
		ReadonlySet<string>
	>(() => new Set());
	const activityTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
		new Map(),
	);
	const commandBuffersRef = useRef<Map<string, string>>(new Map());
	const commandOutputTerminalIdsRef = useRef<Set<string>>(new Set());
	// Tabs the user explicitly closed: their later lifecycle broadcasts (exit
	// after kill) must not resurrect the tab.
	const closedTerminalIdsRef = useRef<Set<string>>(
		null as unknown as Set<string>,
	);
	if (closedTerminalIdsRef.current === null) {
		closedTerminalIdsRef.current = new Set();
	}

	// Reset session state when the workspace changes; an inline-during-render
	// comparison avoids an extra render that an effect-based reset would force.
	const [prevWorkspaceId, setPrevWorkspaceId] = useState(workspaceId);
	if (prevWorkspaceId !== workspaceId) {
		setPrevWorkspaceId(workspaceId);
		setSessions([]);
		setActiveTerminalIds(new Set());
		clearActivityTimers(activityTimersRef.current);
		commandBuffersRef.current.clear();
		commandOutputTerminalIdsRef.current.clear();
		closedTerminalIdsRef.current.clear();
	}

	useEffect(() => {
		let cancelled = false;

		window.ensemblr
			?.listTerminalSessions({ workspaceId })
			.then((result) => {
				if (cancelled) {
					return;
				}
				setSessions(result.sessions);
				if (result.sessions.length === 0) {
					void restoreDockTerminals(workspaceId, () => cancelled, setSessions);
				}
			})
			.catch(() => {
				// Listing is best-effort; lifecycle broadcasts still hydrate state.
			});

		const unsubscribeLifecycle = window.ensemblr?.onTerminalLifecycle(
			(event) => {
				if (
					event.workspaceId !== workspaceId ||
					closedTerminalIdsRef.current.has(event.terminalId)
				) {
					return;
				}

				setSessions((previous) =>
					upsertTerminalSession(previous, event.session),
				);
				if (event.session.status !== 'running') {
					commandBuffersRef.current.delete(event.terminalId);
					removeActiveTerminal(
						event.terminalId,
						activityTimersRef.current,
						setActiveTerminalIds,
						commandOutputTerminalIdsRef.current,
					);
				}
			},
		);

		const unsubscribeOutput = window.ensemblr?.onTerminalOutput((event) => {
			if (
				event.workspaceId !== workspaceId ||
				closedTerminalIdsRef.current.has(event.terminalId) ||
				!commandOutputTerminalIdsRef.current.has(event.terminalId)
			) {
				return;
			}

			markTerminalActive(
				event.terminalId,
				activityTimersRef.current,
				setActiveTerminalIds,
			);
		});

		const handleInput = ({ data, terminalId }: TerminalInputEventDetail) => {
			if (closedTerminalIdsRef.current.has(terminalId)) {
				return;
			}
			const result = reduceTerminalInputActivity(
				commandBuffersRef.current.get(terminalId) ?? '',
				data,
			);
			if (result.interrupted) {
				commandBuffersRef.current.delete(terminalId);
				removeActiveTerminal(
					terminalId,
					activityTimersRef.current,
					setActiveTerminalIds,
					commandOutputTerminalIdsRef.current,
				);
				return;
			}
			commandBuffersRef.current.set(terminalId, result.nextBuffer);
			if (result.commandSubmitted) {
				commandOutputTerminalIdsRef.current.add(terminalId);
				return;
			}
			// A keystroke while output is still streaming is type-ahead into a
			// running command, not a fresh prompt line: keep tracking so the
			// command's real output still counts as activity.
			if (activityTimersRef.current.has(terminalId)) {
				return;
			}
			removeActiveTerminal(
				terminalId,
				activityTimersRef.current,
				setActiveTerminalIds,
				commandOutputTerminalIdsRef.current,
			);
		};
		const unsubscribeInput = subscribeTerminalInput(handleInput);

		return () => {
			cancelled = true;
			unsubscribeLifecycle?.();
			unsubscribeOutput?.();
			unsubscribeInput();
			clearActivityTimers(activityTimersRef.current);
			commandBuffersRef.current.clear();
			commandOutputTerminalIdsRef.current.clear();
		};
	}, [workspaceId]);

	const createTerminal =
		useCallback(async (): Promise<CreateTerminalSessionResult> => {
			const result = (await window.ensemblr?.createTerminalSession({
				workspaceId,
			})) ?? {
				diagnostics: [
					{
						code: 'bridge-unavailable',
						message: 'The Electron preload bridge is unavailable.',
						severity: 'error' as const,
					},
				],
				session: null,
			};
			const session = result.session;

			if (session) {
				setSessions((previous) => upsertTerminalSession(previous, session));
			}

			return result;
		}, [workspaceId]);

	const closeTerminal = useCallback(async (terminalId: string) => {
		closedTerminalIdsRef.current.add(terminalId);
		commandBuffersRef.current.delete(terminalId);
		removeActiveTerminal(
			terminalId,
			activityTimersRef.current,
			setActiveTerminalIds,
			commandOutputTerminalIdsRef.current,
		);
		setSessions((previous) =>
			previous.filter((session) => session.id !== terminalId),
		);

		try {
			await window.ensemblr?.killTerminalSession({ terminalId });
		} catch {
			// The tab is gone either way; main-process cleanup is best-effort.
		}
	}, []);

	return { activeTerminalIds, closeTerminal, createTerminal, sessions };
}
