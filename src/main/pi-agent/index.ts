// Module boundary:
//   `pi-runtime/` — Pi binary surface: executable resolution, readiness
//                   probing, RPC smoke, provider models, agent-directory
//                   resolver. Answers "is Pi installed and runnable?".
//   `pi-agent/`   — Pi session/protocol: adapter, client, session service,
//                   slash command resolver, fakes, summary writer. Drives
//                   live Pi conversations.
//   `pi-ipc/`     — Low-level transport plumbing (JSONL framing) shared
//                   between `pi-runtime/` smoke check and `pi-agent/` adapter.

export type {
	ChildLike,
	CreateCliRpcPiAgentAdapterOptions,
	SpawnFn,
} from './cli-rpc-pi-agent-adapter';
export { createCliRpcPiAgentAdapter } from './cli-rpc-pi-agent-adapter';
export type {
	FakePiAgentAdapterController,
	FakePiAgentAdapterSessionController,
} from './fake-pi-agent-client';
export { createFakePiAgentAdapter } from './fake-pi-agent-client';
export type {
	PiAgentAdapter,
	PiAgentAdapterCreateSessionInput,
	PiAgentAdapterSession,
} from './pi-agent-adapter';
export type {
	CreatePiAgentClientOptions,
	PiAgentClient,
	PiAgentSession,
} from './pi-agent-client';
export { createPiAgentClient, PiAgentClientError } from './pi-agent-client';
export type {
	PiAgentError,
	PiAgentErrorCode,
	PiAgentEvent,
	PiAgentEventListener,
	PiAgentModelMetadata,
	PiAgentSessionId,
	PiAgentSessionMetadata,
	PiAgentSessionRequest,
	PiAgentSessionStatus,
	PiAgentShutdownReason,
	PiAgentSubmitAcknowledgement,
	PiAgentSubmitAttachment,
	PiAgentSubmitRequest,
	PiAgentSubscription,
	PiAgentThinkingMetadata,
} from './pi-agent-types';
export type {
	OpenPiSessionRequest as PiSessionOpenRequest,
	PiSessionService,
	PiSessionSnapshot,
	StopPiSessionRequest as PiSessionStopRequest,
	SubmitPiPromptRequest as PiSessionSubmitRequest,
	SubmitPiPromptResult as PiSessionSubmitResult,
} from './pi-session-service';
export {
	createPiSessionService,
	PiSessionServiceError,
} from './pi-session-service';
export type {
	CreateSessionSummaryWriterOptions,
	SessionSummaryWriter,
	WriteSessionSummaryInput,
	WriteSessionSummaryResult,
} from './session-summary-writer';
export {
	createSessionSummaryWriter,
	writeSessionSummary,
} from './session-summary-writer';
