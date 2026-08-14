import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
	AgentChatTabWire,
	AgentPersistedEnvelope,
	AgentSessionEventWire,
	AgentSessionSnapshotWire,
	WriteForkSummaryRequest,
	WriteForkSummaryResult,
} from '../../shared/ipc/contracts/agent-session';
import {
	DEFAULT_PERMISSION_MODE,
	type PermissionMode,
} from '../../shared/permissions.ts';
import type { AgentControlEnvResolver } from '../agent-control/ports.ts';
import type { CheckpointCapturePort } from '../checkpoints';
import {
	createCheckpointCapture,
	isOrdinalHidden,
	readHiddenEventRanges,
} from '../checkpoints/index.ts';
import type { EnsemblrDatabaseService } from '../storage';
import { requireDatabase } from '../storage/database.ts';
import type {
	AgentSessionBranchRow,
	AgentSessionRow,
	AgentTurnRow,
} from '../storage/repositories';
import {
	type AgentEventRow,
	getMaxOrdinalForBranch,
	iterateBranchPayloadsDescending,
	listEventsByBranch,
} from '../storage/repositories/agent-event-repository.ts';
import {
	getAgentSessionBranchById,
	getAgentSessionById,
	getMainBranchForSession,
	listAgentSessionsByWorkspace,
} from '../storage/repositories/agent-session-repository.ts';
import {
	getChatTabByAgentSessionId,
	getChatTabById,
	listOpenChatTabs,
	renameChatTab,
	setChatTabMetadata,
} from '../storage/repositories/chat-tab-repository.ts';
import type { AgentClient } from './agent-client.ts';
import {
	type AgentSessionOpenRequest,
	type AgentSessionStopRequest,
	type AgentSessionSubmitRequest,
	type AgentSessionSubmitResult,
	createAgentSessionLifecycle,
	type ProviderExecutablePort,
	type QueueNamingPort,
	type SpawnedChildrenPort,
	toSnapshot,
} from './agent-session-lifecycle.ts';
import {
	appendAgentMessageEvent,
	appendChatTitleMetadataEvent,
	appendWorkspaceRenamedMetadataEvent,
	persistRuntimeEvent,
} from './agent-session-persistence.ts';
import { AgentSessionServiceError } from './agent-session-service-error.ts';
import type {
	AgentSessionEventSink,
	AgentSessionSnapshot,
} from './agent-session-types.ts';
import {
	readAgentSummaryMarker,
	withAgentSummaryMarker,
} from './agent-summary.ts';
import {
	sanitizeChatTitle,
	truncateChatTitle,
} from './naming/sanitize-title.ts';
import {
	type ChatTitleProvenance,
	canSetTitle,
	readTitleProvenance,
} from './naming/title-provenance.ts';
import type { TurnPreambleResolver } from './session/agent-control-wiring.ts';
import type { SessionSummaryWriter } from './session-summary-writer.ts';

export type {
	AgentSessionOpenRequest,
	AgentSessionStopRequest,
	AgentSessionSubmitRequest,
	AgentSessionSubmitResult,
	ProviderExecutablePort,
} from './agent-session-lifecycle.ts';
export {
	AgentSessionServiceError,
	type AgentSessionServiceErrorCode,
} from './agent-session-service-error.ts';
export type {
	AgentSessionEventSink,
	AgentSessionSnapshot,
} from './agent-session-types.ts';

/** Dependencies and configuration for constructing the agent session service. */
interface AgentSessionServiceOptions {
	/** Override for tests; defaults to the git-backed capture (ADR 0012). */
	captureCheckpoint?: CheckpointCapturePort;
	databaseService: EnsemblrDatabaseService;
	eventSink?: AgentSessionEventSink;
	agentClient: AgentClient;
	/**
	 * Reads a session's Plan Mode state off the plan-mode registry, so a runtime
	 * that gates on a starting permission mode (Claude) opens in it. Omitted, no
	 * session starts in Plan Mode.
	 */
	isPlanModeActive?: (agentSessionId: string) => boolean;
	/**
	 * Announces a stop the user asked for, before the abort settles the turn to
	 * `idle`. The desktop notifier listens so a cancelled turn is not announced as
	 * one that finished on its own.
	 */
	onSessionAborted?: (sessionId: string) => void;
	/** Derived tab-titling queue, fired at open and each turn-idle. */
	queueNaming: QueueNamingPort;
	/** Injects the agent-control env (control URL + token) into each agent child. */
	resolveAgentControlEnv?: AgentControlEnvResolver;
	/** Renders the per-turn upkeep block for runtimes whose system prompt is fixed at open. */
	resolveTurnPreamble?: TurnPreambleResolver;
	/**
	 * Reads the workspace's permission mode at open time. Omitted, sessions open
	 * under {@link DEFAULT_PERMISSION_MODE} — the same full-workspace control a
	 * workspace with no explicit setting already grants.
	 */
	resolvePermissionMode?: () => PermissionMode;
	/**
	 * Resolves the binary a non-Pi runtime should launch, so a user's executable
	 * override reaches the session rather than only the settings readout.
	 * Omitted, every runtime but Pi opens on whatever binary it ships with.
	 */
	resolveProviderExecutable?: ProviderExecutablePort;
	/**
	 * Resolves the sub-agents a session spawned, so stopping an orchestrator stops
	 * the children it was steering. Omitted, a stop reaches one session.
	 */
	resolveSpawnedChildren?: SpawnedChildrenPort;
	sessionSummaryWriter?: SessionSummaryWriter;
	now?: () => Date;
}

/** Public surface of the agent session service used by IPC handlers. */
export interface AgentSessionService {
	getSession: (sessionId: string) => AgentSessionSnapshot | null;
	listSessionsForWorkspace: (
		workspaceId: string,
	) => readonly AgentSessionSnapshot[];
	listEvents: (branchId: string) => readonly AgentEventRow[];
	/**
	 * Scans a branch's persisted events newest-first, honoring checkpoint hidden
	 * ranges just like {@link AgentSessionService.listEvents}, and yields each
	 * visible payload lazily so a caller that only needs the most recent matching
	 * event (e.g. the last assistant answer) can stop early instead of loading
	 * the whole branch.
	 */
	iterateEventPayloadsDescending: (
		branchId: string,
	) => Iterable<AgentPersistedEnvelope | null>;
	openSession: (
		request: AgentSessionOpenRequest,
	) => Promise<AgentSessionSnapshot>;
	/**
	 * Posts an agent (assistant) message into a session's timeline, persisted and
	 * broadcast through the same path as a runtime message. Lets a main-process
	 * caller surface app-authored content the agent never produced — a
	 * submitted plan above all — so it appears as a real chat bubble regardless of
	 * what the agent itself emitted. A no-op when the session cannot be resolved.
	 */
	appendAgentMessage: (input: { sessionId: string; text: string }) => void;
	/**
	 * Posts the workspace-renamed marker into a session's timeline so the
	 * renderer refetches the workspace whose name and branch just changed. A
	 * no-op when the session cannot be resolved.
	 */
	appendWorkspaceRenamed: (sessionId: string) => void;
	/**
	 * Records an agent-authored summary on the session's chat tab, stamped with
	 * the branch and the event ordinal it describes. Storage only — the summary
	 * file is projected at the next turn boundary, so this never materializes
	 * `.context/` mid-turn. Resolves null when the session has no chat tab.
	 */
	setSessionSummary: (input: {
		sessionId: string;
		title: string;
		summary: string;
	}) => { capturedAtOrdinal: number } | null;
	/**
	 * Sets the display name of an active agent session via its runtime `/name`, then
	 * mirrors the name onto its chat tab under the given provenance. A tab whose
	 * title outranks the caller keeps it and comes back `applied: false`.
	 * Resolves null when the session is not active or the name sanitizes to
	 * nothing.
	 */
	setSessionName: (request: {
		sessionId: string;
		name: string;
		provenance: ChatTitleProvenance;
	}) => Promise<{ applied: boolean; chatTabId: string; title: string } | null>;
	shutdown: () => Promise<void>;
	stopSession: (request: AgentSessionStopRequest) => Promise<void>;
	submitPrompt: (
		request: AgentSessionSubmitRequest,
	) => Promise<AgentSessionSubmitResult>;
	writeForkSummary: (
		request: WriteForkSummaryRequest,
	) => Promise<WriteForkSummaryResult>;
}

/**
 * Coordinates agent runtime sessions with their SQLite persistence: opens a
 * session in the AgentClient, creates the matching `agent_sessions` row, and
 * mirrors every `AgentEvent` into `agent_session_events` for later rehydration.
 *
 * Composes three collaborators wired by dependency injection:
 *   - {@link createAgentSessionLifecycle} — open/submit/stop/runtime-event state machine
 *   - {@link persistRuntimeEvent} — discriminant mapping into `agent_session_events`
 *   - `queueNaming` — best-effort derived tab titling (no model involved)
 *   - `sessionSummaryWriter` — optional live summary updates after agent turns
 */
export function createAgentSessionService({
	captureCheckpoint = createCheckpointCapture(),
	databaseService,
	eventSink,
	agentClient,
	isPlanModeActive = () => false,
	onSessionAborted,
	queueNaming,
	resolveAgentControlEnv,
	resolvePermissionMode = () => DEFAULT_PERMISSION_MODE,
	resolveProviderExecutable,
	resolveTurnPreamble,
	resolveSpawnedChildren,
	sessionSummaryWriter,
	now = () => new Date(),
}: AgentSessionServiceOptions): AgentSessionService {
	const requireSessionDatabase = (): DatabaseSync =>
		requireDatabase(
			databaseService.getConnection()?.database,
			() =>
				new AgentSessionServiceError({
					code: 'database-unavailable',
					message: 'Database is not open; cannot manage agent sessions.',
				}),
		);

	const lifecycle = createAgentSessionLifecycle({
		captureCheckpoint,
		eventSink,
		isPlanModeActive,
		now,
		onSessionAborted,
		persistRuntimeEvent,
		agentClient,
		queueNaming,
		requireDatabase: requireSessionDatabase,
		resolveAgentControlEnv,
		resolvePermissionMode,
		resolveProviderExecutable,
		resolveTurnPreamble,
		resolveSpawnedChildren,
		sessionSummaryWriter,
	});

	/**
	 * Resolves the branch and workspace a synthetic timeline event should land on:
	 * the live branch for an active session, else the persisted main branch.
	 * @param database - Open session database.
	 * @param sessionId - Session whose timeline to target.
	 * @returns The branch and workspace ids, or null when the session is unknown.
	 */
	const resolveTimelineTarget = (
		database: DatabaseSync,
		sessionId: string,
	): { branchId: string; workspaceId: string } | null => {
		const active = lifecycle.getActiveSession(sessionId);
		if (active) {
			return {
				branchId: active.branch.id,
				workspaceId: active.row.workspaceId,
			};
		}
		const row = getAgentSessionById({ database, id: sessionId });
		const branch = getMainBranchForSession({
			database,
			agentSessionId: sessionId,
		});
		if (!row || !branch) {
			return null;
		}
		return { branchId: branch.id, workspaceId: row.workspaceId };
	};

	return {
		getSession: (sessionId) => {
			const database = requireSessionDatabase();
			const active = lifecycle.getActiveSession(sessionId);
			if (active) {
				// The active-session map caches the row from open time, so its
				// `status` is frozen at `starting`; the live status lives in the DB
				// (updated by the runtime status/shutdown handlers). Read the fresh
				// row so status polls (e.g. agent-control `getConversationStatus` /
				// `waitForAgents`) observe streaming → idle, not a stuck `starting`.
				const freshRow =
					getAgentSessionById({ database, id: sessionId }) ?? active.row;
				return toSnapshot({
					branchId: active.branch.id,
					database,
					row: freshRow,
					runtimeOpen: true,
				});
			}
			const row = getAgentSessionById({ database, id: sessionId });
			if (!row) {
				return null;
			}
			const mainBranch = getMainBranchForSession({
				database,
				agentSessionId: row.id,
			});
			if (!mainBranch) {
				return null;
			}
			return toSnapshot({
				branchId: mainBranch.id,
				database,
				row,
				runtimeOpen: false,
			});
		},
		listEvents: (branchId) => {
			const database = requireSessionDatabase();
			const events = listEventsByBranch({ branchId, database });
			// Checkpoint restores hide (never delete) the overwritten turns.
			const branch = getAgentSessionBranchById({ database, id: branchId });
			const hiddenRanges = branch ? readHiddenEventRanges(branch.metadata) : [];
			if (hiddenRanges.length === 0) {
				return events;
			}
			return events.filter(
				(event) => !isOrdinalHidden(event.ordinal, hiddenRanges),
			);
		},
		iterateEventPayloadsDescending: function* (branchId) {
			const database = requireSessionDatabase();
			const branch = getAgentSessionBranchById({ database, id: branchId });
			const hiddenRanges = branch ? readHiddenEventRanges(branch.metadata) : [];
			for (const { ordinal, payload } of iterateBranchPayloadsDescending({
				branchId,
				database,
			})) {
				if (isOrdinalHidden(ordinal, hiddenRanges)) {
					continue;
				}
				yield payload;
			}
		},
		listSessionsForWorkspace: (workspaceId) => {
			const database = requireSessionDatabase();
			const rows = listAgentSessionsByWorkspace({ database, workspaceId });
			const openedTabs = listOpenChatTabs({ database, workspaceId });
			return rows
				.map((row) => {
					const mainBranch = getMainBranchForSession({
						database,
						agentSessionId: row.id,
					});
					if (!mainBranch) {
						return null;
					}
					return toSnapshot({
						branchId: mainBranch.id,
						database,
						openedTabs,
						row,
						runtimeOpen: lifecycle.getActiveSession(row.id) !== null,
					});
				})
				.filter(
					(snapshot): snapshot is AgentSessionSnapshot => snapshot !== null,
				);
		},
		openSession: lifecycle.openSession,
		appendAgentMessage: ({ sessionId, text }) => {
			const database = requireSessionDatabase();
			const target = resolveTimelineTarget(database, sessionId);
			if (!target) {
				return;
			}
			const event = appendAgentMessageEvent({
				branchId: target.branchId,
				database,
				text,
			});
			eventSink?.({ event, sessionId, workspaceId: target.workspaceId });
		},
		appendWorkspaceRenamed: (sessionId) => {
			const database = requireSessionDatabase();
			const target = resolveTimelineTarget(database, sessionId);
			if (!target) {
				return;
			}
			const event = appendWorkspaceRenamedMetadataEvent({
				branchId: target.branchId,
				database,
			});
			eventSink?.({ event, sessionId, workspaceId: target.workspaceId });
		},
		setSessionSummary: ({ sessionId, title, summary }) => {
			const database = requireSessionDatabase();
			const target = resolveTimelineTarget(database, sessionId);
			const tab = getChatTabByAgentSessionId({
				database,
				agentSessionId: sessionId,
			});
			if (!target || !tab) {
				return null;
			}
			const capturedAtOrdinal = getMaxOrdinalForBranch({
				branchId: target.branchId,
				database,
			});
			setChatTabMetadata({
				database,
				id: tab.id,
				metadata: withAgentSummaryMarker(tab.metadata, {
					body: summary,
					branchId: target.branchId,
					capturedAtOrdinal,
					title,
					updatedAt: new Date().toISOString(),
				}),
			});
			return { capturedAtOrdinal };
		},
		setSessionName: async ({ sessionId, name, provenance }) => {
			const database = requireSessionDatabase();
			const applied = await lifecycle.setSessionName(sessionId, name);
			if (!applied) {
				return null;
			}
			const tab = getChatTabById({ database, id: applied.chatTabId });
			if (!tab) {
				return null;
			}
			const sanitized = sanitizeChatTitle(name);
			const fullTitle = sanitized?.full ?? name.trim();
			const title = sanitized?.display ?? truncateChatTitle(fullTitle);
			if (!title) {
				return null;
			}
			if (!canSetTitle(readTitleProvenance(tab.metadata), provenance)) {
				return {
					applied: false,
					chatTabId: applied.chatTabId,
					title: tab.title,
				};
			}
			renameChatTab({ database, fullTitle, id: applied.chatTabId, title });
			setChatTabMetadata({
				database,
				id: applied.chatTabId,
				metadata: {
					...tab.metadata,
					titleAutoNamed: true,
					titleProvenance: provenance,
				},
			});
			const mainBranch = getMainBranchForSession({
				database,
				agentSessionId: sessionId,
			});
			if (mainBranch) {
				const event = appendChatTitleMetadataEvent({
					branchId: mainBranch.id,
					database,
					title,
				});
				eventSink?.({ event, sessionId, workspaceId: tab.workspaceId });
			}
			return { applied: true, chatTabId: applied.chatTabId, title };
		},
		shutdown: async () => {
			await lifecycle.shutdownActiveSessions();
			await agentClient.shutdown();
		},
		stopSession: lifecycle.stopSession,
		submitPrompt: lifecycle.submitPrompt,
		writeForkSummary: async (request) => {
			if (!sessionSummaryWriter) {
				return { error: 'Summary writer is not configured.' };
			}
			const database = requireSessionDatabase();
			const row = getAgentSessionById({ database, id: request.sessionId });
			if (!row) {
				return { error: `No agent session found for id ${request.sessionId}.` };
			}
			const targetCwd = request.targetWorkspaceCwd ?? row.cwd;
			const events: AgentSessionEventWire[] = listEventsByBranch({
				branchId: request.branchId,
				database,
			}).flatMap((event) =>
				request.upToOrdinal === undefined ||
				event.ordinal <= request.upToOrdinal
					? [
							{
								branchId: event.branchId,
								createdAt: event.createdAt,
								eventType: event.eventType,
								id: event.id,
								ordinal: event.ordinal,
								payload: event.payload,
								stream: event.stream,
								turnId: event.turnId,
							},
						]
					: [],
			);
			try {
				const result = await sessionSummaryWriter.writeSessionSummary({
					agentSummary: forkAgentSummary({
						branchId: request.branchId,
						database,
						agentSessionId: request.sessionId,
						upToOrdinal: request.upToOrdinal,
					}),
					branchId: request.branchId,
					chatTabId: request.fileBaseName,
					closedAt: now().toISOString(),
					events,
					// `fork-` prefix keeps the file clear of the destination tab's
					// own live summary (`<chatTabId>.md`).
					fileBaseName: `fork-${request.fileBaseName}`,
					purpose: 'fork',
					runtimeSessionId: row.runtimeSessionId,
					workspaceCwd: targetCwd,
				});
				return {
					summary: {
						absolutePath: result.path,
						relativePath: path.relative(targetCwd, result.path),
						title: result.title,
					},
				};
			} catch (error) {
				return {
					error:
						error instanceof Error
							? error.message
							: 'Failed to write fork summary.',
				};
			}
		},
	};
}

/**
 * Picks the agent's recorded summary for a fork, but only when it describes the
 * conversation at or before the point being forked from.
 *
 * The agent records a summary during its turn, so `capturedAtOrdinal` lands
 * below that turn's last message — which is exactly the ordinal the UI passes
 * as `upToOrdinal` when forking from it. Forking an earlier turn therefore
 * finds a summary captured later and falls back to the transcript, which is the
 * point: reusing it would leak work the fork is meant to exclude.
 * @param input - The source session, its branch, and the fork point.
 * @returns The agent's summary, or null to fall back to the transcript.
 */
function forkAgentSummary({
	branchId,
	database,
	agentSessionId,
	upToOrdinal,
}: {
	branchId: string;
	database: DatabaseSync;
	agentSessionId: string;
	upToOrdinal: number | undefined;
}): { body: string; title: string } | null {
	const tab = getChatTabByAgentSessionId({ database, agentSessionId });
	if (!tab) {
		return null;
	}
	const marker = readAgentSummaryMarker(tab.metadata);
	if (!marker || marker.branchId !== branchId) {
		return null;
	}
	if (upToOrdinal !== undefined && marker.capturedAtOrdinal > upToOrdinal) {
		return null;
	}
	return { body: marker.body, title: marker.title };
}

/**
 * Maps a {@link AgentSessionSnapshot} to the renderer-facing wire shape. Lives in
 * the service so adding a wire field surfaces a compile error here rather than
 * silently dropping data in the IPC layer.
 */
export function snapshotToWire(
	snapshot: AgentSessionSnapshot,
): AgentSessionSnapshotWire {
	const tabs: AgentChatTabWire[] = snapshot.openedTabs.map((tab) => ({
		fullTitle: tab.fullTitle,
		id: tab.id,
		kind: tab.kind,
		openedAt: tab.openedAt,
		agentSessionId: tab.agentSessionId,
		position: tab.position,
		title: tab.title,
		workspaceId: tab.workspaceId,
	}));
	return {
		branchId: snapshot.branchId,
		closedAt: snapshot.closedAt,
		createdAt: snapshot.createdAt,
		cwd: snapshot.cwd,
		id: snapshot.id,
		label: snapshot.label,
		model: snapshot.model,
		openedTabs: tabs,
		provider: snapshot.provider,
		runtimeOpen: snapshot.runtimeOpen,
		runtimeSessionId: snapshot.runtimeSessionId,
		status: snapshot.status,
		thinkingLevel: snapshot.thinkingLevel,
		updatedAt: snapshot.updatedAt,
		workspaceId: snapshot.workspaceId,
	};
}

export type { AgentSessionBranchRow, AgentSessionRow, AgentTurnRow };
