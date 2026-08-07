import type { AgentProviderId } from '../../agent-provider';
import type { SetupCheckLogSnapshot, SetupRemediationAction } from './setup';

/**
 * Captured command output attached to a provider check. Identical to the shape
 * `createCommandLogs` already produces for setup diagnostics, so both surfaces
 * render logs with the same component.
 */
export type CommandLogsWire = readonly SetupCheckLogSnapshot[];

/**
 * A fixable-problem action offered by a provider check. Reuses the setup
 * diagnostics remediation union verbatim — `run-command` is copy-to-clipboard,
 * never execute.
 */
export type SetupRemediationWire = SetupRemediationAction;

/** Outcome of a single provider readiness check. */
export type AgentProviderCheckStatus = 'failure' | 'success' | 'warning';

/**
 * Where the runtime's executable came from. `missing` means nothing resolved —
 * no runtime ships its own binary, so every provider needs one on disk.
 */
export type AgentProviderExecutableSource = 'configured' | 'missing' | 'path';

/** Roll-up of every check in one readiness probe. */
export type AgentProviderReadinessStatus = 'failure' | 'success';

/** One readiness check the Providers page renders as a row. */
export interface AgentProviderCheckWire {
	detail: string | null;
	/** Stable per-provider check id, e.g. `executable`, `auth`, `rpc-smoke`. */
	id: string;
	label: string;
	logs: CommandLogsWire | null;
	remediations: readonly SetupRemediationWire[];
	status: AgentProviderCheckStatus;
}

/**
 * Identity the runtime reports for the signed-in user. Every field is nullable
 * because third-party API backends (Bedrock, Vertex) authenticate externally
 * and report none of them.
 */
export interface AgentProviderAccountWire {
	apiProvider: string | null;
	email: string | null;
	organization: string | null;
	subscriptionType: string | null;
	tokenSource: string | null;
}

/**
 * Connection state of one MCP server, as the runtime reports it. `needs-auth`
 * is the only state the user can act on from Ensemblr, and the composer's MCP
 * panel turns it into a button.
 */
export type AgentProviderMcpStatus =
	| 'connected'
	| 'disabled'
	| 'failed'
	| 'needs-auth'
	| 'pending';

/**
 * One MCP server the runtime has configured, flattened for the wire. Only Claude
 * Code reports these; pi sends an empty roster.
 */
export interface AgentProviderMcpServerWire {
	/** Failure detail the runtime attached, when the server did not connect. */
	error: string | null;
	name: string;
	/**
	 * Where the server is configured — `user`, `project`, `local`, `dynamic`
	 * (plugin-supplied), `claudeai` (remote connector) — when the runtime says.
	 */
	scope: string | null;
	status: AgentProviderMcpStatus;
}

/** Request for one runtime's MCP roster as it resolves inside a workspace. */
export interface ListAgentProviderMcpServersRequest {
	/**
	 * Workspace directory to resolve the roster against. Project- and local-scope
	 * servers are defined relative to it, so a global lookup would miss them.
	 */
	cwd: string;
	provider: AgentProviderId;
}

/**
 * One runtime's MCP roster. `error` carries why the roster is empty when the
 * runtime could not be asked, so the caller distinguishes "none configured"
 * from "could not read".
 */
export interface ListAgentProviderMcpServersResult {
	error: string | null;
	servers: readonly AgentProviderMcpServerWire[];
}

/**
 * Provider-neutral readiness snapshot. Both tabs of the Providers page render
 * from this one shape; the provider-specific richness lives in `checks[]`.
 */
export interface AgentProviderReadinessWire {
	/** Signed-in identity, when the runtime exposes one. Pi reports `null`. */
	account: AgentProviderAccountWire | null;
	checks: readonly AgentProviderCheckWire[];
	executablePath: string | null;
	executableSource: AgentProviderExecutableSource;
	provider: AgentProviderId;
	status: AgentProviderReadinessStatus;
	updatedAt: string;
	version: string | null;
}

/**
 * State of one provider's executable override, used to hydrate the override
 * field. `overridePath` reflects only the user's own SQLite setting so the
 * input never shows a PATH- or config-derived value as if it were typed.
 */
export interface AgentExecutablePathSnapshotWire {
	/** Message from the write that produced this snapshot; `null` on reads and successes. */
	error: string | null;
	overridePath: string | null;
	provider: AgentProviderId;
	resolvedPath: string | null;
	/** Resolution source of the executable (e.g. `sqlite`, `path`, `missing`). */
	source: string | null;
	status: string;
}

/** Result of prompting the user to pick an agent runtime's executable. */
export interface AgentExecutableSelectionWire {
	canceled: boolean;
	error?: string;
	selectedPath?: string;
}

/** Request addressing one agent runtime and nothing else. */
export interface AgentProviderRequest {
	provider: AgentProviderId;
}

/** Request setting an explicit executable override for one agent runtime. */
export interface SetAgentProviderExecutablePathRequest {
	path: string;
	provider: AgentProviderId;
}

/** Request opening a runtime's own settings file in a detected "Open in" target. */
export interface OpenAgentProviderSettingsFileRequest {
	provider: AgentProviderId;
	/** Id of a target from `listWorkspaceOpenTargets`. */
	target: string;
}

/** Result of opening a runtime's settings file. */
export interface OpenAgentProviderSettingsFileResult {
	error?: string;
	opened: boolean;
}

/**
 * Provider-parameterized IPC surface. Every channel takes an `AgentProviderId`
 * so Pi and Claude Code are siblings on one surface rather than two duplicated
 * per-provider domains; main rejects an unknown id instead of falling back.
 */
export interface AgentProviderApi {
	clearAgentProviderExecutablePath: (
		request: AgentProviderRequest,
	) => Promise<AgentExecutablePathSnapshotWire>;
	getAgentProviderExecutablePath: (
		request: AgentProviderRequest,
	) => Promise<AgentExecutablePathSnapshotWire>;
	getAgentProviderReadiness: (
		request: AgentProviderRequest,
	) => Promise<AgentProviderReadinessWire>;
	listAgentProviderMcpServers: (
		request: ListAgentProviderMcpServersRequest,
	) => Promise<ListAgentProviderMcpServersResult>;
	openAgentProviderSettingsFile: (
		request: OpenAgentProviderSettingsFileRequest,
	) => Promise<OpenAgentProviderSettingsFileResult>;
	selectAgentProviderExecutable: (
		request: AgentProviderRequest,
	) => Promise<AgentExecutableSelectionWire>;
	setAgentProviderExecutablePath: (
		request: SetAgentProviderExecutablePathRequest,
	) => Promise<AgentExecutablePathSnapshotWire>;
}
