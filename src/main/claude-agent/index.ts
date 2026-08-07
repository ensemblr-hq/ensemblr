// Module boundary:
//   `claude-agent/` — the Claude Code adapter, driven through
//                     `@anthropic-ai/claude-agent-sdk`. Implements
//                     `agent-runtime`'s `AgentAdapter` and owns every SDK
//                     option name, exactly as `pi-agent/` owns every `pi` flag.
//
// This concern must not import from `pi-agent/`, and `pi-agent/` must not
// import from here: they are siblings over `agent-runtime/`.

export type { CreateClaudeAgentAdapterOptions } from './claude-agent-adapter';
export { createClaudeAgentAdapter } from './claude-agent-adapter';
export { buildClaudeMcpServers } from './claude-mcp-config';
export type { CreateClaudeMcpRosterOptions } from './claude-mcp-roster';
export { createClaudeMcpRoster } from './claude-mcp-roster';
export { presentClaudeModels } from './claude-model-catalog';
export type { CreateClaudeModelListerOptions } from './claude-model-lister';
export { createClaudeModelLister } from './claude-model-lister';
export type {
	ClaudeApprovalGate,
	ClaudeCanUseTool,
	ClaudePermissionSettings,
	ClaudeSessionApproval,
} from './claude-permission-bridge';
export {
	buildCanUseTool,
	createPlaceholderCanUseTool,
	resolvePermissionSettings,
	toClaudePermissionSettings,
} from './claude-permission-bridge';
export type { ClaudePlanBridgeOptions } from './claude-plan-bridge';
export { createClaudePlanBridge } from './claude-plan-bridge';
export type {
	ClaudePlanSubmission,
	ClaudePlanSubmittedEvent,
} from './claude-plan-mode';
export { detectPlanSubmission } from './claude-plan-mode';
export type { CreateClaudeSlashCommandsOptions } from './claude-slash-commands';
export { createClaudeSlashCommands } from './claude-slash-commands';
export { toClaudeEffortLevel, toThinkingLevels } from './claude-thinking';
// `claude-tool-approval-ipc.ts` is deliberately absent: it imports `electron`,
// and this barrel is loaded by Vitest suites running under plain Node. main.ts
// imports `installClaudeToolApproval` from that module directly.
export type {
	ClaudeToolApprovalCoordinator,
	ClaudeToolApprovalCoordinatorOptions,
} from './claude-tool-approval';
export { createClaudeToolApprovalCoordinator } from './claude-tool-approval';
export type {
	CreateSdkMessageNormalizerOptions,
	SdkMessageNormalizer,
	SdkSessionDiscovery,
} from './sdk-message-normalizer';
export { createSdkMessageNormalizer } from './sdk-message-normalizer';
