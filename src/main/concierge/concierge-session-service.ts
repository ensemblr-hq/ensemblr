import type { DatabaseSync } from 'node:sqlite';

import {
	type AgentProviderId,
	DEFAULT_AGENT_PROVIDER,
} from '../../shared/agent-provider.ts';
import type {
	ClearConciergeContextRequest,
	ClearConciergeContextResult,
	ConciergeContextPressureWire,
	ConciergeEventBroadcastWire,
	ConciergeSessionEventWire,
	ConciergeSessionSnapshotWire,
	ListConciergeEventsRequest,
	ListConciergeEventsResult,
	OpenConciergeSessionRequest,
	OpenConciergeSessionResult,
	StopConciergeSessionRequest,
	StopConciergeSessionResult,
	SubmitConciergePromptRequest,
	SubmitConciergePromptResult,
} from '../../shared/ipc/contracts/concierge.ts';
import {
	type AgentClient,
	AgentClientError,
	type AgentSession,
} from '../agent-runtime/agent-client.ts';
import { eventPayload } from '../agent-runtime/agent-session-persistence.ts';
import type {
	AgentEvent,
	AgentExecutableSnapshot,
	AgentSubscription,
} from '../agent-runtime/agent-types.ts';
import {
	appendConciergeEvent,
	type ConciergeEventRow,
	type ConciergeSessionRow,
	createConciergeSession,
	getActiveConciergeSession,
	getConciergeSessionById,
	listConciergeEvents,
	updateConciergeSession,
} from '../storage/repositories/concierge-session-repository.ts';
import type { ConciergeHome } from './concierge-home.ts';
import { runConciergeMemoryPass } from './concierge-memory-pass.ts';

/** Runtime settings a Concierge session opens under, read fresh on every open. */
export interface ConciergeRuntimeSettings {
	/** Fraction of the context window that trips the automatic clear, 0-1. */
	autoClearAtPercent: number;
	model: string | null;
	provider: AgentProviderId;
	thinkingLevel: string | null;
}

/** Environment and MCP wiring injected into a Concierge runtime child. */
export interface ConciergeControlWiring {
	controlMcp?: { token: string; url: string } | null;
	env?: Record<string, string | null | undefined>;
	resolveTurnPreamble?: (() => Promise<string | null>) | null;
	systemPromptAppend?: string | null;
}

/** Dependencies for {@link createConciergeSessionService}. */
export interface ConciergeSessionServiceOptions {
	agentClient: AgentClient;
	/** Broadcasts a persisted event to open windows; absent in tests. */
	eventSink?: (broadcast: ConciergeEventBroadcastWire) => void;
	/** Resolves the concierge home, re-read per open so a root change is picked up. */
	resolveHome: () => ConciergeHome;
	now?: () => Date;
	/**
	 * Resolves the control-server env and MCP endpoint for the Concierge child.
	 * Takes the session id because the overlay carries a token minted per
	 * session, and the provider because only a runtime the app drives over MCP
	 * takes an endpoint; absent in tests, which open a child with no control
	 * tools.
	 */
	resolveControlWiring?: (input: {
		provider: AgentProviderId;
		sessionId: string;
	}) => Promise<ConciergeControlWiring>;
	/**
	 * Drops the control origin a closed session held, so its token stops
	 * resolving. Absent in tests and whenever control is not wired.
	 */
	releaseControlOrigin?: (sessionId: string) => void;
	/** Resolves the binary a runtime should launch; absent lets the adapter pick. */
	resolveExecutable?: (
		provider: AgentProviderId,
	) => Promise<AgentExecutableSnapshot | null>;
	/**
	 * Every directory outside the home the Concierge may read — in practice each
	 * open workspace plus the managed `repos/` tree. Runtimes that sandbox by
	 * working directory take these at launch, so the set is fixed per session.
	 */
	resolveReadableDirectories: () => readonly string[];
	resolveSettings: () => ConciergeRuntimeSettings;
	requireDatabase: () => DatabaseSync;
	/**
	 * Overrides the memory-write turn a clear runs first. Absent, the service
	 * runs its own against the live runtime child, which is what production
	 * wants; a test that opens no runtime supplies a stub instead.
	 */
	runMemoryPass?: (sessionId: string) => Promise<boolean>;
}

/** Public surface of the Concierge session service. */
export interface ConciergeSessionService {
	clearContext: (
		request: ClearConciergeContextRequest,
	) => Promise<ClearConciergeContextResult>;
	contextPressure: () => ConciergeContextPressureWire;
	listEvents: (
		request: ListConciergeEventsRequest,
	) => ListConciergeEventsResult;
	openSession: (
		request: OpenConciergeSessionRequest,
	) => Promise<OpenConciergeSessionResult>;
	shutdown: () => Promise<void>;
	stopSession: (
		request: StopConciergeSessionRequest,
	) => Promise<StopConciergeSessionResult>;
	submitPrompt: (
		request: SubmitConciergePromptRequest,
	) => Promise<SubmitConciergePromptResult>;
}

/** What the service reports when it has no runtime child to hand a caller. */
const SESSION_NOT_OPEN_MESSAGE = 'The Concierge session is not open.';

/** The live runtime attachment for the one open Concierge session. */
interface ActiveConciergeSession {
	/** Latest usage the runtime reported, for the composer's context gauge. */
	contextUsage: {
		maxTokens: number | null;
		percent: number | null;
		usedTokens: number | null;
	} | null;
	runtimeSession: AgentSession;
	sessionId: string;
	subscription: AgentSubscription;
}

/**
 * Converts the stored 0-1 fraction to the 0-100 percentage the runtimes report.
 *
 * The setting is a fraction because that is what its schema constrains and what
 * "share of the context window" means; every runtime reports
 * `(tokens / window) * 100`. Comparing the two directly made a fresh session at
 * 2% used trip a threshold meant to mean 80%.
 */
const PERCENT_PER_FRACTION = 100;

/**
 * Decides whether the context has filled enough to offer a clear.
 *
 * Pure, and exported, because the two numbers it compares come from different
 * scales and got compared raw once already. A threshold of zero disables the
 * offer outright rather than firing on the first token.
 * @param input - The reported usage percentage and the stored 0-1 threshold.
 * @returns The pressure snapshot the panel renders its banner from.
 */
export function conciergeContextPressure({
	autoClearAtFraction,
	maxTokens = null,
	percent,
	usedTokens = null,
}: {
	autoClearAtFraction: number;
	maxTokens?: number | null;
	percent: number | null;
	usedTokens?: number | null;
}): ConciergeContextPressureWire {
	const thresholdPercent = autoClearAtFraction * PERCENT_PER_FRACTION;
	return {
		maxTokens,
		overThreshold:
			thresholdPercent > 0 && percent !== null && percent >= thresholdPercent,
		percent,
		thresholdPercent,
		usedTokens,
	};
}

/**
 * Projects a session row onto its renderer-facing snapshot.
 * @param row - Persisted session row.
 * @param runtimeOpen - Whether a runtime child is currently attached.
 * @returns The wire snapshot.
 */
function toSnapshot(
	row: ConciergeSessionRow,
	runtimeOpen: boolean,
): ConciergeSessionSnapshotWire {
	return {
		closedAt: row.closedAt,
		createdAt: row.createdAt,
		cwd: row.cwd,
		id: row.id,
		lastError: row.lastError,
		model: row.model,
		provider: row.provider,
		runtimeOpen,
		status: row.status,
		thinkingLevel: row.thinkingLevel,
		title: row.title,
		updatedAt: row.updatedAt,
	};
}

/**
 * Projects a persisted event row onto its wire shape.
 * @param row - Persisted event row.
 * @returns The wire event.
 */
function toEventWire(row: ConciergeEventRow): ConciergeSessionEventWire {
	return {
		createdAt: row.createdAt,
		eventType: row.eventType,
		id: row.id,
		ordinal: row.ordinal,
		payload: row.payload,
		sessionId: row.sessionId,
		stream: row.stream,
	};
}

/**
 * Coerces a thrown value into a message safe to persist and show.
 * @param error - Thrown value.
 * @returns A human-readable message.
 */
function toMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Reports whether a failure means the runtime child behind the session is gone,
 * as opposed to a turn the live child refused.
 * @param error - Thrown value from a runtime call.
 * @returns True when the session is closed and only a replacement can serve it.
 */
function isSessionClosedFailure(error: unknown): boolean {
	return error instanceof AgentClientError && error.code === 'session-closed';
}

/**
 * Owns the one Concierge conversation: opening it against a runtime, persisting
 * its transcript, and replacing it when the context is cleared.
 *
 * It deliberately reuses nothing from `agent-session-service`, because that
 * service's whole shape — branches, turns, checkpoints, chat tabs — exists to
 * serve a workspace, and the Concierge has none. What it does share is the
 * runtime seam: `AgentClient.createSession` takes a `cwd`, not a workspace, so
 * the provider-neutral layer needed no change to serve an agent that lives
 * above every project.
 * @param options - Runtime client, storage, and the ports that resolve context.
 * @returns The Concierge session service.
 */
export function createConciergeSessionService({
	agentClient,
	eventSink,
	now = () => new Date(),
	releaseControlOrigin,
	requireDatabase,
	resolveControlWiring,
	resolveExecutable,
	resolveHome,
	resolveReadableDirectories,
	resolveSettings,
	runMemoryPass,
}: ConciergeSessionServiceOptions): ConciergeSessionService {
	let active: ActiveConciergeSession | null = null;
	let openInFlight: Promise<OpenConciergeSessionResult> | null = null;

	/**
	 * Persists one runtime event and pushes it to open windows. Best-effort: a
	 * write that fails must not tear down the stream, because the transcript
	 * rehydrates from whatever did land. Every database call is inside the guard,
	 * status included — at quit the connection closes under the trailing
	 * `closed` event, and a throw out of this callback skips every later
	 * subscriber on the same emit.
	 * @param sessionId - Session the event belongs to.
	 * @param event - The runtime event.
	 */
	const handleRuntimeEvent = (sessionId: string, event: AgentEvent): void => {
		if (event.type === 'context-usage' && active?.sessionId === sessionId) {
			active = {
				...active,
				contextUsage: {
					maxTokens: event.usage.contextWindow,
					percent: event.usage.percent,
					usedTokens: event.usage.tokens,
				},
			};
		}
		try {
			if (event.type === 'status' && active?.sessionId === sessionId) {
				updateConciergeSession({
					database: requireDatabase(),
					id: sessionId,
					patch: { status: event.status },
				});
			}
			const row = appendConciergeEvent({
				database: requireDatabase(),
				input: {
					createdAt: event.at,
					eventType: event.type,
					payload: eventPayload(event),
					sessionId,
					stream: event.type === 'error' ? 'stderr' : 'protocol',
				},
			});
			eventSink?.({ event: toEventWire(row), sessionId });
		} catch {
			return;
		}
	};

	/**
	 * Detaches the live runtime child, leaving the row intact so the transcript
	 * survives. Safe to call when nothing is attached.
	 */
	const detach = async (): Promise<void> => {
		if (!active) {
			return;
		}
		const current = active;
		active = null;
		current.subscription.unsubscribe();
		releaseControlOrigin?.(current.sessionId);
		try {
			await current.runtimeSession.close();
		} catch {
			return;
		}
	};

	/**
	 * Attaches a runtime child to a persisted session row, closing whatever was
	 * attached before rather than dropping it: `active` holds one session, so an
	 * overwrite would strand the previous child, its subscription, and its
	 * control origin with no handle left to reach any of them.
	 * @param row - The session row to attach.
	 * @returns The row as it stands after the attach, streaming status included.
	 */
	const attachRuntime = async (
		row: ConciergeSessionRow,
	): Promise<ConciergeSessionRow> => {
		const database = requireDatabase();
		const settings = resolveSettings();
		const starting =
			updateConciergeSession({
				database,
				id: row.id,
				patch: { lastError: null, status: 'starting' },
			}) ?? row;

		try {
			// Inside the guard because resolving it registers a control origin, and
			// an origin left behind is a live bearer token resolving to a Concierge
			// identity for a session that never opened.
			const control =
				(await resolveControlWiring?.({
					provider: row.provider,
					sessionId: row.id,
				})) ?? {};
			const runtimeSession = await agentClient.createSession({
				agentSessionId: row.id,
				controlMcp: control.controlMcp ?? null,
				env: control.env,
				executable: (await resolveExecutable?.(row.provider)) ?? null,
				label: 'Concierge',
				linkedDirectories: resolveReadableDirectories(),
				modelOverride: row.model ?? settings.model,
				permissionMode: 'workspace-trusted',
				provider: row.provider,
				resolveTurnPreamble: control.resolveTurnPreamble ?? null,
				resumeRuntimeSession: Boolean(row.runtimeSessionId),
				runtimeSessionId: row.runtimeSessionId ?? row.id,
				systemPromptAppend: control.systemPromptAppend ?? null,
				thinkingLevel: row.thinkingLevel ?? settings.thinkingLevel,
				workspaceCwd: row.cwd,
			});

			await detach();
			const subscription = runtimeSession.subscribe((event) => {
				handleRuntimeEvent(row.id, event);
			});
			active = {
				contextUsage: null,
				runtimeSession,
				sessionId: row.id,
				subscription,
			};

			return (
				updateConciergeSession({
					database,
					id: row.id,
					patch: {
						runtimeSessionId: runtimeSession.getMetadata().sessionId ?? null,
						status: 'idle',
					},
				}) ?? starting
			);
		} catch (error) {
			releaseControlOrigin?.(row.id);
			updateConciergeSession({
				database,
				id: row.id,
				patch: {
					closedAt: now().toISOString(),
					lastError: toMessage(error),
					status: 'errored',
				},
			});
			throw error;
		}
	};

	/**
	 * Opens or resumes the one Concierge session. Split out of the public method
	 * so a second caller can be handed the open already running rather than
	 * starting its own.
	 * @param request - Whether to force a new session rather than resume.
	 * @returns The opened session, or the failure that stopped it.
	 */
	const runOpenSession = async ({
		fresh,
	}: OpenConciergeSessionRequest): Promise<OpenConciergeSessionResult> => {
		const database = requireDatabase();
		// Read whatever is open regardless of `fresh`, so a session being
		// replaced is still closed rather than left behind for a later resume to
		// find. A row remembers the runtime it opened on, and a runtime cannot
		// change under a live session — so one whose provider the user has since
		// changed is not resumable however open it looks. Resuming it anyway put
		// the previous runtime back and sent it the new runtime's model.
		const openRow = getActiveConciergeSession({ database });
		const existing =
			!fresh && openRow?.provider === resolveSettings().provider
				? openRow
				: null;

		if (existing && active?.sessionId === existing.id) {
			return { session: toSnapshot(existing, true) };
		}

		await detach();
		try {
			if (existing) {
				return { session: toSnapshot(await attachRuntime(existing), true) };
			}
			// Closing whatever was open before opening its replacement: a row left
			// open is one `getActiveConciergeSession` would hand back later, so a
			// session abandoned for a runtime change or a `fresh` open would come
			// back from the dead the next time the panel resumed.
			if (openRow) {
				updateConciergeSession({
					database,
					id: openRow.id,
					patch: { closedAt: now().toISOString(), status: 'closed' },
				});
			}
			return { session: toSnapshot(await attachRuntime(createRow()), true) };
		} catch (error) {
			return { error: toMessage(error) };
		}
	};

	/**
	 * Serialises opens so only one runs at a time. Two concurrent callers both
	 * saw no live session, both created one, and the second overwrote the first —
	 * stranding a runtime child nothing could close and a row that stayed open
	 * forever.
	 * @param request - Whether to force a new session rather than resume.
	 * @returns The opened session, or the failure that stopped it.
	 */
	const openSessionOnce = async (
		request: OpenConciergeSessionRequest,
	): Promise<OpenConciergeSessionResult> => {
		try {
			return await runOpenSession(request);
		} finally {
			openInFlight = null;
		}
	};

	/**
	 * Runs the memory-write turn a clear is about to discard the context of,
	 * preferring an injected override and otherwise driving the live runtime
	 * child. Reports false rather than throwing when there is no live session to
	 * ask: the clear is what the user pressed, and it proceeds either way.
	 * @param sessionId - Session the clear is about to close.
	 * @returns True when the runtime completed the turn.
	 */
	const runMemoryPassFor = async (sessionId: string): Promise<boolean> => {
		if (runMemoryPass) {
			return await runMemoryPass(sessionId);
		}
		const live = active;
		return live?.sessionId === sessionId
			? await runConciergeMemoryPass({ session: live.runtimeSession })
			: false;
	};

	/**
	 * The wire snapshot of the session that is live right now, for a caller whose
	 * prompt landed somewhere other than the session it named.
	 *
	 * Best-effort: this adorns a submit the runtime has already accepted, so a
	 * database that closed under it costs the caller the id it should adopt
	 * rather than the acknowledgement it earned.
	 * @param sessionId - The live session's id.
	 * @returns The snapshot, or null when its row cannot be read.
	 */
	const liveSnapshot = (
		sessionId: string,
	): ConciergeSessionSnapshotWire | null => {
		try {
			const row = getConciergeSessionById({
				database: requireDatabase(),
				id: sessionId,
			});
			return row ? toSnapshot(row, true) : null;
		} catch {
			return null;
		}
	};

	/**
	 * Opens the Concierge session, handing a caller that arrives mid-open the
	 * attempt already running rather than starting a second one beside it.
	 * @param request - Whether to force a new session rather than resume.
	 * @returns The opened session, or the failure that stopped it.
	 */
	const openSession = (
		request: OpenConciergeSessionRequest,
	): Promise<OpenConciergeSessionResult> => {
		if (!openInFlight) {
			openInFlight = openSessionOnce(request);
		}
		return openInFlight;
	};

	/**
	 * Puts a live runtime child back under the Concierge after the previous one
	 * died, resuming the conversation where the runtime can and starting a clean
	 * session where it cannot.
	 *
	 * `detach` runs first because the replacement is unreachable while the corpse
	 * is still in `active`: an open row whose id matches the attachment is handed
	 * straight back, which for a dead child is the dead child again.
	 * @returns The now-live attachment and its snapshot, or why none could open.
	 */
	const reviveSession = async (): Promise<
		| { error: string }
		| { live: ActiveConciergeSession; session: ConciergeSessionSnapshotWire }
	> => {
		await detach();
		const resumed = await openSession({ fresh: false });
		const reopened = resumed.session
			? resumed
			: await openSession({ fresh: true });
		return reopened.session && active
			? { live: active, session: reopened.session }
			: { error: reopened.error ?? SESSION_NOT_OPEN_MESSAGE };
	};

	/**
	 * Opens a fresh session row against the concierge home.
	 * @returns The created row.
	 */
	const createRow = (): ConciergeSessionRow => {
		const settings = resolveSettings();
		return createConciergeSession({
			database: requireDatabase(),
			input: {
				cwd: resolveHome().rootPath,
				model: settings.model,
				provider: settings.provider ?? DEFAULT_AGENT_PROVIDER,
				thinkingLevel: settings.thinkingLevel,
			},
		});
	};

	return {
		clearContext: async ({
			reason,
			skipMemoryPass,
		}: ClearConciergeContextRequest): Promise<ClearConciergeContextResult> => {
			const database = requireDatabase();
			const current = active
				? getConciergeSessionById({ database, id: active.sessionId })
				: getActiveConciergeSession({ database });

			let memoryPassRan = false;
			if (current && !skipMemoryPass) {
				try {
					memoryPassRan = await runMemoryPassFor(current.id);
				} catch {
					memoryPassRan = false;
				}
			}

			await detach();
			if (current) {
				updateConciergeSession({
					database,
					id: current.id,
					patch: {
						closedAt: now().toISOString(),
						metadata: { ...current.metadata, clearedBy: reason },
						status: 'closed',
					},
				});
			}

			try {
				const row = await attachRuntime(createRow());
				return { memoryPassRan, session: toSnapshot(row, true) };
			} catch (error) {
				return { error: toMessage(error), memoryPassRan };
			}
		},

		contextPressure: (): ConciergeContextPressureWire =>
			conciergeContextPressure({
				autoClearAtFraction: resolveSettings().autoClearAtPercent,
				maxTokens: active?.contextUsage?.maxTokens ?? null,
				percent: active?.contextUsage?.percent ?? null,
				usedTokens: active?.contextUsage?.usedTokens ?? null,
			}),

		listEvents: ({
			fromOrdinal,
			sessionId,
		}: ListConciergeEventsRequest): ListConciergeEventsResult => ({
			events: listConciergeEvents({
				database: requireDatabase(),
				fromOrdinal,
				sessionId,
			}).map(toEventWire),
		}),

		openSession,

		shutdown: detach,

		stopSession: async ({
			reason,
			sessionId,
		}: StopConciergeSessionRequest): Promise<StopConciergeSessionResult> => {
			if (active?.sessionId !== sessionId) {
				return { error: SESSION_NOT_OPEN_MESSAGE, ok: false };
			}
			try {
				await active.runtimeSession.abort(reason);
				return { ok: true };
			} catch (error) {
				return { error: toMessage(error), ok: false };
			}
		},

		/**
		 * Sends one prompt into whatever conversation is live, replacing the
		 * session first only when its runtime child is gone. The panel holds one
		 * conversation and no control that restarts it, so a child lost to a stop,
		 * a crash, or a runtime that closed itself left every later prompt bouncing
		 * off a dead session with nothing but an error line and a retype to show
		 * for it.
		 *
		 * A caller naming a session that has since been replaced is served by the
		 * live child rather than by a new one: the id it holds is stale — a submit
		 * that raced a clear, a second window a turn behind — and tearing the live
		 * child down to rebuild it would throw away a turn it may be streaming.
		 * The snapshot comes back either way, so the panel adopts the conversation
		 * its prompt actually landed in.
		 */
		submitPrompt: async ({
			model,
			prompt,
			sessionId,
			thinkingLevel,
		}: SubmitConciergePromptRequest): Promise<SubmitConciergePromptResult> => {
			const request = {
				prompt,
				...(model ? { modelOverride: model } : {}),
				...(thinkingLevel ? { thinkingLevel } : {}),
			};

			const live = active;
			if (live) {
				try {
					const acknowledgement = await live.runtimeSession.submit(request);
					const adopted =
						live.sessionId === sessionId ? null : liveSnapshot(live.sessionId);
					return {
						acceptedAt: acknowledgement.acceptedAt,
						...(adopted ? { session: adopted } : {}),
					};
				} catch (error) {
					if (!isSessionClosedFailure(error)) {
						return { error: toMessage(error) };
					}
				}
			}

			const revived = await reviveSession();
			if ('error' in revived) {
				return { error: revived.error };
			}
			try {
				const acknowledgement =
					await revived.live.runtimeSession.submit(request);
				return {
					acceptedAt: acknowledgement.acceptedAt,
					session: revived.session,
				};
			} catch (error) {
				return { error: toMessage(error) };
			}
		},
	};
}
