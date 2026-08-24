import type { AgentProviderId } from '../../agent-provider.ts';
import type { AgentPersistedEnvelope } from './agent-session.ts';

/** Lifecycle status of the Concierge session, mirroring the agent-session vocabulary. */
export type ConciergeSessionStatusWire =
	| 'closed'
	| 'errored'
	| 'idle'
	| 'starting'
	| 'streaming';

/** Renderer-facing snapshot of the Concierge session. */
export interface ConciergeSessionSnapshotWire {
	closedAt: string | null;
	createdAt: string;
	cwd: string;
	id: string;
	lastError: string | null;
	model: string | null;
	provider: AgentProviderId;
	/** True when an agent runtime child is currently attached for this session. */
	runtimeOpen: boolean;
	status: ConciergeSessionStatusWire;
	thinkingLevel: string | null;
	title: string;
	updatedAt: string;
}

/** Source stream a Concierge transcript event came from. */
export type ConciergeEventStreamWire = 'protocol' | 'stderr';

/** One event in the Concierge transcript, as the renderer receives it. */
export interface ConciergeSessionEventWire {
	createdAt: string;
	eventType: string;
	id: string;
	ordinal: number;
	/** Tagged envelope; `null` when the stored JSON could not be parsed. */
	payload: AgentPersistedEnvelope | null;
	sessionId: string;
	stream: ConciergeEventStreamWire;
}

/** Broadcast wrapper for a Concierge event pushed to open windows. */
export interface ConciergeEventBroadcastWire {
	event: ConciergeSessionEventWire;
	sessionId: string;
}

/** Open or resume the Concierge session. */
export interface OpenConciergeSessionRequest {
	/** Opens a new session instead of resuming the most recent open one. */
	fresh?: boolean;
}

/** Result of opening the Concierge session. */
export interface OpenConciergeSessionResult {
	error?: string;
	session?: ConciergeSessionSnapshotWire;
}

/** Submit a prompt to the open Concierge session. */
export interface SubmitConciergePromptRequest {
	model?: string | null;
	prompt: string;
	sessionId: string;
	thinkingLevel?: string | null;
}

/** Result of submitting a prompt to the Concierge. */
export interface SubmitConciergePromptResult {
	acceptedAt?: string;
	error?: string;
	/**
	 * The session the prompt actually landed in, present whenever the one the
	 * caller named could not take it and a live session had to be put back
	 * underneath — the same conversation resumed, or a clean one where it could
	 * not be. The panel adopts it so its transcript follows what is now live.
	 */
	session?: ConciergeSessionSnapshotWire;
}

/** Stop the Concierge's streaming turn. */
export interface StopConciergeSessionRequest {
	reason?: string;
	sessionId: string;
}

/** Result of stopping the Concierge's streaming turn. */
export interface StopConciergeSessionResult {
	error?: string;
	ok: boolean;
}

/** Read the Concierge transcript, optionally from an ordinal onward. */
export interface ListConciergeEventsRequest {
	fromOrdinal?: number;
	sessionId: string;
}

/** The Concierge transcript as the renderer receives it. */
export interface ListConciergeEventsResult {
	events: readonly ConciergeSessionEventWire[];
}

/**
 * Why the Concierge context is being cleared. `manual` is the user pressing the
 * control; `threshold` is the automatic trip once the transcript crosses its
 * high-water mark.
 */
export type ConciergeClearReason = 'manual' | 'threshold';

/**
 * Clear the Concierge context. The replacement conversation comes back at once
 * and the retired one writes its memories in the background, unless the caller
 * opts out of that turn entirely.
 */
export interface ClearConciergeContextRequest {
	reason: ConciergeClearReason;
	/** Skips the memory-write turn; the retired conversation is closed as-is. */
	skipMemoryPass?: boolean;
}

/** Result of clearing the Concierge context. */
export interface ClearConciergeContextResult {
	error?: string;
	/**
	 * True when a background memory-write turn was started on the conversation
	 * this clear retired. Nothing waits on it — the replacement session in
	 * `session` is already live — so this reports that the turn began, never that
	 * it finished or what it wrote.
	 */
	memoryPassStarted: boolean;
	session?: ConciergeSessionSnapshotWire;
}

/**
 * How full the Concierge's context is, and whether it has tripped its threshold.
 *
 * Both numbers are percentages on a 0-100 scale, matching what the runtimes
 * report and what the workspace context indicator renders. The stored setting is
 * a 0-1 fraction, so the service converts it here rather than leaving two scales
 * to be compared by whoever reads this — which is how a fresh session at 2% used
 * came to trip a threshold meant to mean 80%.
 */
export interface ConciergeContextPressureWire {
	/** Size of the context window in tokens, or null when none is reported. */
	maxTokens: number | null;
	/** True once usage crossed the configured high-water mark. */
	overThreshold: boolean;
	/** Percent of the context window in use, 0-100, or null when none is reported. */
	percent: number | null;
	/** The high-water mark, 0-100. */
	thresholdPercent: number;
	/** Tokens consumed so far, or null when none is reported. */
	usedTokens: number | null;
}

/** Concierge IPC surface: session lifecycle, transcript, and context clearing. */
export interface ConciergeApi {
	clearConciergeContext: (
		request: ClearConciergeContextRequest,
	) => Promise<ClearConciergeContextResult>;
	conciergeContextPressure: () => Promise<ConciergeContextPressureWire>;
	listConciergeEvents: (
		request: ListConciergeEventsRequest,
	) => Promise<ListConciergeEventsResult>;
	onConciergeSessionEvent: (
		listener: (broadcast: ConciergeEventBroadcastWire) => void,
	) => () => void;
	openConciergeSession: (
		request: OpenConciergeSessionRequest,
	) => Promise<OpenConciergeSessionResult>;
	stopConciergeSession: (
		request: StopConciergeSessionRequest,
	) => Promise<StopConciergeSessionResult>;
	submitConciergePrompt: (
		request: SubmitConciergePromptRequest,
	) => Promise<SubmitConciergePromptResult>;
}
