import type { PiExecutableSnapshot } from '../pi/pi-executable.ts';

/** Stable identifier for a Pi agent session within the main process. */
export type PiAgentSessionId = string;

/** Lifecycle stage reported by the underlying Pi runtime. */
export type PiAgentSessionStatus =
	| 'closed'
	| 'errored'
	| 'idle'
	| 'starting'
	| 'streaming';

/** Why a session finished or was torn down. */
export type PiAgentShutdownReason =
	| 'aborted'
	| 'completed'
	| 'crashed'
	| 'manual';

/** Stable error taxonomy raised across the PiAgentClient boundary. */
export type PiAgentErrorCode =
	| 'adapter-failure'
	| 'invalid-cwd'
	| 'invalid-executable'
	| 'session-closed'
	| 'spawn-error'
	| 'submit-failed';

/** Boundary-level error attached to events or thrown from API methods. */
export interface PiAgentError {
	code: PiAgentErrorCode;
	detail?: string;
	message: string;
	recoverable: boolean;
}

/** Model attribution exposed by the Pi runtime, when known. */
export interface PiAgentModelMetadata {
	displayName?: string;
	id: string;
	provider: string;
}

/** Thinking/reasoning mode metadata exposed by the Pi runtime, when known. */
export interface PiAgentThinkingMetadata {
	budgetTokens?: number;
	mode: 'high' | 'low' | 'medium' | 'off';
}

/** Snapshot of session state, returned by `PiAgentSession.getMetadata`. */
export interface PiAgentSessionMetadata {
	args: readonly string[];
	command: string;
	cwd: string;
	env: Record<string, string>;
	id: PiAgentSessionId;
	label: string;
	model: PiAgentModelMetadata | null;
	piAgentDirectoryPreserved: boolean;
	sessionId: string | null;
	startedAt: string;
	status: PiAgentSessionStatus;
	thinking: PiAgentThinkingMetadata | null;
	updatedAt: string;
}

/** Caller-supplied request that opens a Pi agent session. */
export interface PiAgentSessionRequest {
	/** Resolved Pi executable. Used as the spawn command. */
	executable: PiExecutableSnapshot;
	/** Working directory for the launched process — typically the workspace path. */
	workspaceCwd: string;
	/** Caller-supplied env overlay. `null` or `undefined` values are treated as "unset". */
	env?: Record<string, string | null | undefined>;
	/**
	 * When true (default), the client refuses to inject `PI_CODING_AGENT_DIR`
	 * into the launched env, even if the caller passes it. The user's shell
	 * value flows through untouched. Set to false to allow an explicit override.
	 */
	preservePiAgentDirectory?: boolean;
	/** Optional model override propagated to the Pi runtime when supported. */
	modelOverride?: string | null;
	/** Optional human-readable label attached to session metadata for logs. */
	label?: string;
}

/** Inline or referenced attachment included with a prompt submission. */
export interface PiAgentSubmitAttachment {
	contentBase64?: string;
	kind: 'file' | 'inline';
	name: string;
	path?: string;
}

/** Caller-supplied prompt submission. */
export interface PiAgentSubmitRequest {
	attachments?: readonly PiAgentSubmitAttachment[];
	modelOverride?: string;
	prompt: string;
}

/** Acknowledgement returned synchronously after a successful submit. */
export interface PiAgentSubmitAcknowledgement {
	acceptedAt: string;
	turnId: string;
}

/** Discriminated event stream emitted by a session. */
export type PiAgentEvent =
	| {
			at: string;
			error: PiAgentError;
			type: 'error';
	  }
	| {
			at: string;
			metadata: PiAgentSessionMetadata;
			type: 'metadata';
	  }
	| {
			at: string;
			payload: unknown;
			role: 'agent' | 'tool' | 'user';
			turnId: string | null;
			type: 'message';
	  }
	| {
			at: string;
			previous: PiAgentSessionStatus;
			status: PiAgentSessionStatus;
			type: 'status';
	  }
	| {
			at: string;
			reason: PiAgentShutdownReason;
			type: 'shutdown';
	  };

/** Listener registered through `PiAgentSession.subscribe`. */
export type PiAgentEventListener = (event: PiAgentEvent) => void;

/** Handle returned by `PiAgentSession.subscribe`. */
export interface PiAgentSubscription {
	unsubscribe: () => void;
}
