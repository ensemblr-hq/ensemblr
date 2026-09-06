// Module boundary:
//   `agent-providers/` — the provider-parameterized settings surface. It owns
//   executable discovery/override persistence and readiness probing for every
//   agent runtime behind one shared interface, so Pi and Claude Code are
//   siblings rather than one routed through the other's vocabulary.
//
// Pi's probe adapts `pi-runtime`'s `PiReadinessService`; Claude's talks to the
// Agent SDK directly. Neither runtime concern imports from here.

export type {
	AgentModelCatalogService,
	CreateAgentModelCatalogOptions,
} from './agent-model-catalog';
export { createAgentModelCatalog } from './agent-model-catalog';
export type { CreateAgentProviderServiceOptions } from './agent-provider-service';
export { createAgentProviderService } from './agent-provider-service';
export type {
	AgentExecutableResolution,
	AgentProviderExecutableService,
	AgentProviderReadinessProbe,
	AgentProviderService,
} from './agent-provider-types';
export { toExecutableSource } from './agent-provider-types';
export type { CreateClaudeExecutableServiceOptions } from './claude-executable';
export {
	createClaudeExecutableService,
	resolveClaudeExecutable,
} from './claude-executable';
export type { CreateClaudeReadinessProbeOptions } from './claude-readiness-probe';
export { createClaudeReadinessProbe } from './claude-readiness-probe';
export type { CreatePiReadinessProbeOptions } from './pi-readiness-probe';
export { createPiReadinessProbe } from './pi-readiness-probe';
export type {
	CreateSpawnModelResolverOptions,
	SpawnCallerIdentity,
	SpawnModelListing,
	SpawnModelResolution,
	SpawnModelResolver,
	SpawnModelSelection,
} from './spawn-model-resolver';
export {
	acceptableThinkingLevels,
	createSpawnModelResolver,
} from './spawn-model-resolver';
