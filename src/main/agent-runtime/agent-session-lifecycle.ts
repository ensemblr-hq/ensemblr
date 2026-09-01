import type { DatabaseSync } from 'node:sqlite';
import type { AgentProviderId } from '../../shared/agent-provider.ts';
import type {
	OpenAgentSessionRequest as OpenAgentSessionWireRequest,
	StopAgentSessionRequest as StopAgentSessionWireRequest,
	SubmitAgentPromptRequest as SubmitAgentPromptWireRequest,
} from '../../shared/ipc/contracts/agent-session';
import type { PermissionMode } from '../../shared/permissions.ts';
import type { AgentControlEnvResolver } from '../agent-control/ports.ts';
import type { CheckpointCapturePort } from '../checkpoints';
import type { PiExecutableSnapshot } from '../pi-runtime';
import {
	type AgentSessionBranchRow,
	type AgentSessionRow,
	createTurn,
	updateAgentSession,
	updateTurn,
} from '../storage/repositories/agent-session-repository.ts';
import type { AgentClient } from './agent-client.ts';
import { AgentSessionServiceError } from './agent-session-service-error.ts';
import type {
	AgentSessionEventSink,
	AgentSessionSnapshot,
} from './agent-session-types.ts';
import type { SessionNamingInput } from './naming/session-naming.ts';
import {
	type ActiveSessionMap,
	isTurnInFlight,
} from './session/active-session.ts';
import type {
	SubagentMechanismReader,
	TurnPreambleResolver,
} from './session/agent-control-wiring.ts';
import {
	createRuntimeEventHandler,
	type PersistRuntimeEventPort,
} from './session/handle-runtime-event.ts';
import { assertProviderPin } from './session/provider-pin.ts';
import {
	createSessionOpener,
	type ProviderExecutablePort,
} from './session/session-open.ts';
import {
	createSummaryQueue,
	type SummaryPersistedListener,
} from './session/summary-queue.ts';
import type { SessionSummaryWriter } from './session-summary-writer.ts';

export type { PersistRuntimeEventPort } from './session/handle-runtime-event.ts';
export type { ProviderExecutablePort } from './session/session-open.ts';
export { toSnapshot } from './session/session-snapshot.ts';

/**
 * Lifecycle-side open request. Extends the wire `OpenAgentSessionRequest` with
 * the resolved `PiExecutableSnapshot` that the composition root injects from
 * `pi-runtime` before calling into the lifecycle. The wire shape is the public
 * IPC contract; this interface documents the divergence at the type level so a
 * field added on either side surfaces here.
 */
export interface AgentSessionOpenRequest extends OpenAgentSessionWireRequest {
	executable: PiExecutableSnapshot;
	/**
	 * Session id of the agent that spawned this one, when opened through the
	 * agent-control layer. Threaded into the child's control-env origin so
	 * lineage (depth, deadlock) guardrails apply. Absent for user-opened sessions.
	 */
	parentSessionId?: string | null;
	/**
	 * Agent runtime the requested model needs, derived in the main process from
	 * the merged model catalog rather than accepted off the wire. Pins a new
	 * session; on a resume it is checked against the row's own provider and a
	 * mismatch is rejected. Absent when no catalog claims the model.
	 */
	provider?: AgentProviderId;
}

/**
 * Lifecycle-side submit request. Extends the wire shape with the runtime the
 * requested model needs, which the main process derives from its own catalog so
 * a mid-conversation model switch cannot cross the session's provider pin.
 */
export interface AgentSessionSubmitRequest
	extends SubmitAgentPromptWireRequest {
	provider?: AgentProviderId;
}

/** Result of submitting a prompt to an open agent session. */
export interface AgentSessionSubmitResult {
	acceptedAt: string;
	turnId: string;
}

/**
 * Lifecycle-side stop request. Currently identical to the wire shape — see
 * {@link AgentSessionSubmitRequest} for the rationale.
 */
export type AgentSessionStopRequest = StopAgentSessionWireRequest;

/** Naming port — lifecycle fires this at open and each turn-idle; it self-gates. */
export type QueueNamingPort = (input: SessionNamingInput) => void;

/**
 * Lineage port — resolves the sessions a given session spawned as sub-agents, so
 * a stop can reach them. Backed by the agent-control origin registry.
 */
export type SpawnedChildrenPort = (sessionId: string) => readonly string[];

/** Stop reason recorded on a sub-agent stopped because its orchestrator was. */
const ORCHESTRATOR_STOPPED_REASON = 'orchestrator-stopped';

/**
 * Stop reason recorded on a turn aborted because its workspace was removed.
 * Reached from the repository layer's pre-removal teardown; kept here so every
 * stop reason the lifecycle records is declared in one place.
 */
export const WORKSPACE_REMOVED_STOP_REASON = 'workspace-removed';

/** Dependencies and configuration for {@link createAgentSessionLifecycle}. */
interface AgentSessionLifecycleOptions {
	/** Pre-prompt git checkpoint capture (ADR 0012); absent in tests. */
	captureCheckpoint?: CheckpointCapturePort;
	eventSink: AgentSessionEventSink | undefined;
	/** Reads a session's Plan Mode state off the plan-mode registry. */
	isPlanModeActive: (agentSessionId: string) => boolean;
	now: () => Date;
	/**
	 * Announces a stop the user asked for, before the abort settles the turn to
	 * `idle`. The desktop notifier listens so a cancelled turn does not read as
	 * one that finished on its own.
	 */
	onSessionAborted?: (sessionId: string) => void;
	/**
	 * Announces a summary that has landed on disk. Summary writes are async and
	 * finish after the close that triggered them has already answered the
	 * renderer, so without this the surfaces reading closed-tab summaries keep a
	 * result taken before the file existed.
	 */
	onSummaryPersisted?: SummaryPersistedListener;
	persistRuntimeEvent: PersistRuntimeEventPort;
	agentClient: AgentClient;
	/** Derived tab titling, fired at open and every turn-idle. */
	queueNaming: QueueNamingPort;
	requireDatabase: () => DatabaseSync;
	/** Reads the delegation mechanism a Claude Code session must open under. */
	readClaudeSubagentMode?: SubagentMechanismReader;
	/** Injects the agent-control env (control URL + token) into each agent child. */
	resolveAgentControlEnv?: AgentControlEnvResolver;
	/** Renders the per-turn upkeep block for runtimes whose system prompt is fixed at open. */
	resolveTurnPreamble?: TurnPreambleResolver;
	/** Reads the workspace permission mode each session must open under. */
	resolvePermissionMode: () => PermissionMode;
	/** Resolves the binary a non-Pi runtime should launch; see {@link ProviderExecutablePort}. */
	resolveProviderExecutable?: ProviderExecutablePort;
	/**
	 * Resolves a session's spawned sub-agents so stopping it stops them too.
	 * Omitted, a stop reaches only the session it names.
	 */
	resolveSpawnedChildren?: SpawnedChildrenPort;
	sessionSummaryWriter?: SessionSummaryWriter;
}

/** Public surface of the agent session lifecycle: open, submit, stop, and shut down active sessions. */
interface AgentSessionLifecycle {
	/**
	 * Writes the summary owed by whichever active session backs `chatTabId`, and
	 * resolves once it is on disk. The close path awaits this so an archived tab
	 * records the turn it was closed on rather than the one before it.
	 */
	flushSummaryForChatTab: (chatTabId: string) => Promise<void>;
	getActiveSession: (sessionId: string) => ActiveSessionView | null;
	openSession: (
		request: AgentSessionOpenRequest,
	) => Promise<AgentSessionSnapshot>;
	/**
	 * Asks an active session's runtime to re-read the account's plan windows now,
	 * so what moved reaches the composer as a `plan-windows` event. Resolves false
	 * when the session is not active or its runtime could not answer.
	 */
	refreshPlanUsage: (sessionId: string) => Promise<boolean>;
	/**
	 * Pushes a display name into the live agent runtime (`/name`) for an active
	 * session, returning the chat tab it is bound to so the caller can mirror the
	 * name onto the tab. Resolves null when the session is not currently active.
	 */
	setSessionName: (
		sessionId: string,
		name: string,
	) => Promise<{ chatTabId: string } | null>;
	shutdownActiveSessions: () => Promise<void>;
	stopSession: (request: AgentSessionStopRequest) => Promise<void>;
	submitPrompt: (
		request: AgentSessionSubmitRequest,
	) => Promise<AgentSessionSubmitResult>;
}

/** Read-only view of an active session for the composition root. */
interface ActiveSessionView {
	branch: AgentSessionBranchRow;
	row: AgentSessionRow;
}

/**
 * Owns the active-session map and the open/submit/stop/runtime-event state
 * machine. Persistence, runtime-event fan-out, summary queueing, and the
 * open/resume flow are delegated to focused helpers under `./session/`.
 */
export function createAgentSessionLifecycle({
	captureCheckpoint,
	eventSink,
	isPlanModeActive,
	now,
	onSessionAborted,
	onSummaryPersisted,
	persistRuntimeEvent,
	agentClient,
	queueNaming,
	readClaudeSubagentMode,
	requireDatabase,
	resolveAgentControlEnv,
	resolvePermissionMode,
	resolveProviderExecutable,
	resolveTurnPreamble,
	resolveSpawnedChildren,
	sessionSummaryWriter,
}: AgentSessionLifecycleOptions): AgentSessionLifecycle {
	const activeSessions: ActiveSessionMap = new Map();

	const summaryQueue = createSummaryQueue({
		activeSessions,
		now,
		onSummaryPersisted,
		sessionSummaryWriter,
	});

	const runtimeEventHandler = createRuntimeEventHandler({
		activeSessions,
		eventSink,
		now,
		persistRuntimeEvent,
		queueNaming,
		summaryQueue,
	});

	const opener = createSessionOpener({
		activeSessions,
		eventSink,
		isPlanModeActive,
		now,
		agentClient,
		queueNaming,
		readClaudeSubagentMode,
		resolveAgentControlEnv,
		resolvePermissionMode,
		resolveProviderExecutable,
		resolveTurnPreamble,
		subscribeToRuntime: ({ branchId, database, runtimeSession, sessionId }) =>
			runtimeSession.subscribe((event) => {
				runtimeEventHandler.handle({
					branchId,
					database,
					event,
					sessionId,
				});
			}),
	});

	const openSession: AgentSessionLifecycle['openSession'] = (request) =>
		opener.openSession({ database: requireDatabase(), request });

	const submitPrompt: AgentSessionLifecycle['submitPrompt'] = async (
		request,
	) => {
		const database = requireDatabase();
		const active = activeSessions.get(request.sessionId);
		if (!active) {
			throw new AgentSessionServiceError({
				code: 'session-not-open',
				message: `Agent session ${request.sessionId} is not open.`,
			});
		}
		assertProviderPin({
			pinned: active.row.provider,
			requested: request.provider,
		});

		// Mid-turn steer/follow-up: don't open a new turn, change status, or
		// checkpoint — the message is injected into the in-flight (steer) or next
		// (follow-up) turn. Just forward the native RPC frame.
		if (request.streamingBehavior) {
			return active.agentRuntimeSession.submit({
				prompt: request.prompt,
				streamingBehavior: request.streamingBehavior,
			});
		}

		const turn = createTurn({
			database,
			input: {
				branchId: active.branch.id,
				model: request.model ?? null,
				promptText: request.prompt,
				thinkingLevel: request.thinkingLevel ?? null,
			},
		});

		activeSessions.set(request.sessionId, {
			...active,
			activeTurnId: turn.id,
			agentResponsePendingSummary: false,
		});
		updateAgentSession({
			database,
			id: request.sessionId,
			patch: {
				model: request.model ?? active.row.model,
				status: 'streaming',
				thinkingLevel: request.thinkingLevel ?? active.row.thinkingLevel,
			},
		});

		// Capture the pre-prompt file state before the runtime can touch files.
		// Runs after the session map update so a concurrent submit/stop never
		// observes a turn that exists in SQLite but not in activeSessions.
		// The port owns the warn-and-continue failure policy (ADR 0012).
		if (captureCheckpoint) {
			await captureCheckpoint({
				cwd: active.row.cwd,
				database,
				label: summarizePromptForLabel(request.prompt),
				agentSessionId: request.sessionId,
				turnId: turn.id,
				workspaceId: active.row.workspaceId,
			});
		}

		const acknowledgement = await active.agentRuntimeSession.submit({
			modelOverride: request.model ?? undefined,
			planMode: request.planMode ?? isPlanModeActive(request.sessionId),
			prompt: request.prompt,
			thinkingLevel: request.thinkingLevel ?? undefined,
		});
		return acknowledgement;
	};

	/**
	 * Aborts one session's in-flight turn and closes it, leaving anything it
	 * spawned untouched. A session that is not currently active is already
	 * stopped, so this is a no-op for it.
	 *
	 * An idle session is wound down with `close` rather than `abort`, because a
	 * stop that reaches every session of a workspace — the teardown archiving or
	 * deleting one runs — otherwise writes the "you stopped this turn" marker
	 * into chats that were running nothing, and restamps their last settled turn
	 * as aborted. Its last turn settles `completed` instead, which is what that
	 * turn did before the stop arrived.
	 * @param request - The session to stop and the reason to record.
	 */
	const abortActiveSession = async (
		request: AgentSessionStopRequest,
	): Promise<void> => {
		const database = requireDatabase();
		const active = activeSessions.get(request.sessionId);
		if (!active) {
			return;
		}
		const turnInFlight = isTurnInFlight(database, request.sessionId);
		// Announce the stop before the abort, because aborting settles the turn to
		// `idle` on its way out and a listener told only afterwards would already
		// have read that as a turn finishing by itself.
		if (turnInFlight) {
			onSessionAborted?.(request.sessionId);
		}
		// Start the owed summary before aborting so it snapshots the active session,
		// but never block the user's explicit stop on archival summary work. The
		// flush reads the transcript synchronously before its first await, so the
		// snapshot is captured before the abort/delete below. Durability is now
		// best-effort: if the process exits immediately after this stop, the
		// backgrounded write may not finish (the session is already removed from
		// activeSessions, so shutdownActiveSessions cannot re-flush it).
		void summaryQueue
			.flushSummaryForSession({
				database,
				sessionId: request.sessionId,
			})
			.catch(() => undefined);
		if (turnInFlight) {
			await active.agentRuntimeSession.abort(request.reason);
		} else {
			await active.agentRuntimeSession.close();
		}
		// The runtime's own `shutdown` event settles this turn too, but it is not
		// guaranteed to land first: Pi's `close` gives up waiting on a wedged child
		// after its kill deadline, so the event can arrive once this session is
		// already out of `activeSessions` and no longer carries the turn to stamp.
		if (active.activeTurnId) {
			updateTurn({
				database,
				id: active.activeTurnId,
				patch: {
					completedAt: now().toISOString(),
					status: turnInFlight ? 'aborted' : 'completed',
				},
			});
		}
		updateAgentSession({
			database,
			id: request.sessionId,
			patch: { status: 'closed', closedAt: now().toISOString() },
		});
		// Stopping a turn tears down the runtime child but must never touch the
		// chat tab: tab lifecycle is owned solely by the chat-tab service (which
		// enforces the minimum-one-open-tab rule and idempotent close). Dropping
		// the session from the active map flips `runtimeOpen` false so the next
		// submit into this tab transparently resumes the persisted session.
		activeSessions.delete(request.sessionId);
	};

	/**
	 * Stops a session and then every sub-agent below it in the lineage. A spawned
	 * child's tab carries no composer, so the orchestrator is the only thing that
	 * can end its turn — leaving it running once that orchestrator stops strands an
	 * agent nobody is reading. `stopped` makes a lineage that points back at itself
	 * terminate, and a child that refuses to abort is logged rather than thrown, so
	 * one stuck sub-agent cannot fail the stop the user asked for. The descendants
	 * are collected in a `finally` because a wedged session is both the likeliest
	 * one to fail its abort and the one whose children most need collecting; its
	 * failure still reaches the caller, it just no longer strands the lineage.
	 * @param request - The session to stop and the reason to record.
	 * @param stopped - Session ids this cascade already visited.
	 */
	const stopSessionTree = async (
		request: AgentSessionStopRequest,
		stopped: Set<string>,
	): Promise<void> => {
		if (stopped.has(request.sessionId)) {
			return;
		}
		stopped.add(request.sessionId);
		const children = resolveSpawnedChildren?.(request.sessionId) ?? [];
		try {
			await abortActiveSession(request);
		} finally {
			await Promise.all(
				children.map(async (sessionId) => {
					try {
						await stopSessionTree(
							{ reason: ORCHESTRATOR_STOPPED_REASON, sessionId },
							stopped,
						);
					} catch (cause) {
						console.warn(
							'[agent-session] could not stop a spawned sub-agent.',
							{
								cause: cause instanceof Error ? cause.message : String(cause),
								sessionId,
							},
						);
					}
				}),
			);
		}
	};

	const stopSession: AgentSessionLifecycle['stopSession'] = (request) =>
		stopSessionTree(request, new Set());

	return {
		flushSummaryForChatTab: (chatTabId) =>
			summaryQueue.flushSummaryForChatTab({
				chatTabId,
				database: requireDatabase(),
			}),
		getActiveSession: (sessionId) => {
			const active = activeSessions.get(sessionId);
			if (!active) {
				return null;
			}
			return { branch: active.branch, row: active.row };
		},
		openSession,
		refreshPlanUsage: async (sessionId) => {
			const active = activeSessions.get(sessionId);
			if (!active) {
				return false;
			}
			return active.agentRuntimeSession.refreshPlanUsage();
		},
		setSessionName: async (sessionId, name) => {
			const active = activeSessions.get(sessionId);
			if (!active) {
				return null;
			}
			await active.agentRuntimeSession.setSessionName(name);
			return { chatTabId: active.chatTabId };
		},
		shutdownActiveSessions: async () => {
			const open = [...activeSessions.entries()];
			// Flush owed summaries while sessions are still registered: once the
			// map is cleared and the runtime closed, no shutdown event can drain
			// the queue (the subscription is gone), so a final summary would be
			// lost. Best-effort — a teardown DB error must not block shutdown.
			try {
				const database = requireDatabase();
				await Promise.all(
					open.map(([sessionId]) =>
						summaryQueue.flushSummaryForSession({ database, sessionId }),
					),
				);
				// Also await drains for sessions already removed from the active map
				// (a stopSession that backgrounded its flush), so their final summary
				// is not lost when the process exits right after.
				await summaryQueue.awaitInFlight();
			} catch {
				// Database unavailable during teardown; skip the final flush.
			}
			activeSessions.clear();
			for (const [, session] of open) {
				session.subscription.unsubscribe();
			}
			await Promise.all(
				open.map(([, session]) =>
					session.agentRuntimeSession.close().catch(() => undefined),
				),
			);
		},
		stopSession,
		submitPrompt,
	};
}

/** First line of the prompt, trimmed to a short checkpoint label. */
function summarizePromptForLabel(prompt: string): string {
	const firstLine =
		prompt.split('\n').find((line) => line.trim().length > 0) ?? '';
	const trimmed = firstLine.trim();
	if (trimmed.length === 0) {
		return 'Checkpoint';
	}
	return trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed;
}
