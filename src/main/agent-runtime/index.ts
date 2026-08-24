// Module boundary:
//   `agent-runtime/` — provider-neutral agent vocabulary: the session request,
//                      the normalized event stream, the adapter contract, the
//                      client that dispatches across providers, and the session
//                      service that persists, names, and summarizes a
//                      conversation. Knows no CLI flags and no SDK option names.
//   `pi-agent/`      — the Pi adapter (`pi --mode rpc`), its wire normalizer,
//                      and its slash commands.
//   `claude-agent/`  — the Claude Code adapter, driven through
//                      `@anthropic-ai/claude-agent-sdk`.
//
// `pi-agent/` and `claude-agent/` are siblings: both implement `AgentAdapter`
// and neither imports the other. A new runtime adds a provider id in
// `shared/agent-provider.ts`, a concern beside these two, and an entry in the
// client's adapter map — nothing else.

export type {
	AgentAdapter,
	AgentAdapterCreateSessionInput,
	AgentAdapterSession,
} from './agent-adapter';
export type {
	AgentClient,
	AgentSession,
	CreateAgentClientOptions,
} from './agent-client';
export { AgentClientError, createAgentClient } from './agent-client';
export { WORKSPACE_REMOVED_STOP_REASON } from './agent-session-lifecycle';
export type {
	AgentSessionOpenRequest,
	AgentSessionService,
	AgentSessionSnapshot,
	AgentSessionStopRequest,
	AgentSessionSubmitRequest,
	AgentSessionSubmitResult,
	ProviderExecutablePort,
} from './agent-session-service';
export {
	AgentSessionServiceError,
	createAgentSessionService,
	snapshotToWire,
} from './agent-session-service';
export type {
	AgentContextUsage,
	AgentControlMcpConfig,
	AgentError,
	AgentErrorCode,
	AgentEvent,
	AgentEventListener,
	AgentExecutableSnapshot,
	AgentMessagePart,
	AgentMessagePayload,
	AgentModelMetadata,
	AgentSessionId,
	AgentSessionMetadata,
	AgentSessionRequest,
	AgentSessionState,
	AgentSessionStatus,
	AgentShutdownReason,
	AgentSubmitAcknowledgement,
	AgentSubmitAttachment,
	AgentSubmitRequest,
	AgentSubscription,
	AgentThinkingMetadata,
} from './agent-types';
export { isAgentExecutableReady } from './agent-types';
export type {
	FakeAgentAdapterController,
	FakeAgentAdapterSessionController,
} from './fake-agent-adapter';
export { createFakeAgentAdapter } from './fake-agent-adapter';
export { usesNativeControlMcp } from './session/agent-control-wiring';
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
