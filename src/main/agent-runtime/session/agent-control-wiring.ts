/**
 * Resolves what the agent-control layer contributes to one session's open
 * request: the env overlay every runtime spawns with, plus the two fields a
 * runtime that speaks MCP natively also needs — the loopback endpoint to
 * connect to and the role playbook to append to its own system prompt.
 *
 * Pi takes neither of the latter two. Its bundled extension is its MCP client
 * and reads the same overlay out of `process.env` itself, so handing Pi an
 * endpoint and a playbook would duplicate what the extension already injects.
 */
import {
	type AgentControlRole,
	awarenessForAudience,
	type SubagentMechanism,
} from '../../../shared/agent-control.ts';
import type { AgentProviderId } from '../../../shared/agent-provider.ts';
import {
	CONTROL_ROLE_ENV_KEY,
	CONTROL_TOKEN_ENV_KEY,
	CONTROL_URL_ENV_KEY,
} from '../../agent-control/control-env-keys.ts';
import type {
	AgentControlEnvResolver,
	AgentSpecies,
} from '../../agent-control/ports.ts';
import type { AgentControlMcpConfig } from '../agent-types.ts';

/** The env value {@link CONTROL_ROLE_ENV_KEY} carries for a spawned child. */
const SUBAGENT_ROLE: AgentControlRole = 'subagent';

/**
 * Runtimes that connect to the Ensemblr Control MCP server themselves. Declared
 * as a capability rather than tested by name at each use, so a third runtime
 * says once whether it brings its own MCP client.
 */
const NATIVE_MCP_PROVIDERS: ReadonlySet<AgentProviderId> = new Set(['claude']);

/**
 * Whether a runtime reaches the control server through its own MCP client, and
 * so needs the loopback endpoint handed to it at session open. A runtime that
 * does not — Pi, which loads the shipped extension — reads the same control
 * server out of its env instead.
 * @param provider - The runtime a session is pinned to.
 * @returns True when the session needs the MCP endpoint on its open request.
 */
export function usesNativeControlMcp(provider: AgentProviderId): boolean {
	return NATIVE_MCP_PROVIDERS.has(provider);
}

/**
 * Runtimes that ship a sub-agent tool of their own, and so have two delegation
 * mechanisms to choose between. A runtime absent from this set always resolves
 * to `ensemblr`: withholding the chat-tab spawn ops from a runtime with nothing
 * to fall back on would leave it unable to delegate at all.
 */
const NATIVE_SUBAGENT_PROVIDERS: ReadonlySet<AgentProviderId> = new Set([
	'claude',
]);

/** Reads the user's chosen delegation mechanism for the Claude Code runtime. */
export type SubagentMechanismReader = () => SubagentMechanism;

/** Reads the durable sub-agent marker off the chat tab bound to a session. */
export type SubAgentMarkerReader = (sessionId: string) => boolean;

/**
 * Resolves the mechanism a session opens under from its lineage, the runtime it
 * is pinned to, and the user's setting.
 *
 * A spawned child takes `ensemblr` whatever the setting says. The setting picks
 * how a *root* fans out, and nested delegation is blocked on every other axis —
 * `SUBAGENT_BLOCKED_OPS` refuses the spawn ops and `SUBAGENT_AWARENESS` says a
 * child never fans out — so letting a child open under `native` would leave the
 * runtime's own sub-agent tool live and route an unbounded fan-out around the
 * depth cap.
 *
 * Lineage alone cannot say whether a session is a child. `parentSessionId` rides
 * the open request, and a resume carries none, so a child reopened after a
 * restart would read as a root and pick up the user's `native` setting — the
 * exact escape the paragraph above rules out. The durable marker is checked
 * alongside it for the same reason the control layer's role resolution prefers
 * it: it is a column on the chat tab rather than a process fact.
 * @param isSpawnedSubAgent - Reads the durable sub-agent marker, when available.
 * @param parentSessionId - The session that spawned this one, when any.
 * @param provider - The runtime the session runs on.
 * @param readClaudeSubagentMode - Reads the persisted Claude Code preference.
 * @param sessionId - The session being opened, whose marker to read.
 * @returns The mechanism to pin on this session.
 */
function resolveDelegation({
	isSpawnedSubAgent,
	parentSessionId,
	provider,
	readClaudeSubagentMode,
	sessionId,
}: {
	isSpawnedSubAgent: SubAgentMarkerReader | undefined;
	parentSessionId: string | null;
	provider: AgentProviderId;
	readClaudeSubagentMode: SubagentMechanismReader | undefined;
	sessionId: string;
}): SubagentMechanism {
	if (parentSessionId || isSpawnedSubAgent?.(sessionId) === true) {
		return 'ensemblr';
	}
	if (!NATIVE_SUBAGENT_PROVIDERS.has(provider) || !readClaudeSubagentMode) {
		return 'ensemblr';
	}
	return readClaudeSubagentMode();
}

/** Resolves everything the app prepends to one agent session's turn. */
export type TurnPreambleResolver = (
	sessionId: string,
) => Promise<string | null>;

/** What the agent-control layer contributes to one session's open request. */
export interface AgentControlWiring {
	controlMcp: AgentControlMcpConfig | null;
	/**
	 * The mechanism pinned on this session, which the runtime adapter needs in
	 * order to deny the mechanism the user did not pick. Reported even when the
	 * control server is down, because the adapter's deny list does not depend on
	 * the control tools being reachable.
	 */
	delegation: SubagentMechanism;
	env: Record<string, string> | undefined;
	resolveTurnPreamble: (() => Promise<string | null>) | null;
	systemPromptAppend: string | null;
}

/**
 * The control-layer species a runtime's sessions register under. Every agent
 * provider is a first-class runtime driving a native chat tab, so a provider id
 * names a species directly and neither is ever `harness`; a provider added
 * without a matching species fails to compile here rather than registering as
 * Pi and passing the chat-tab gates for the wrong reason.
 * @param provider - The runtime a session is pinned to.
 * @returns The species to register the session's control origin under.
 */
function speciesForProvider(provider: AgentProviderId): AgentSpecies {
	return provider;
}

/**
 * Reads the caller's role back off the overlay. Resolving it needs the durable
 * sub-agent marker and the registry's lineage depth, both of which only the
 * resolver holds, so the resolved answer travels in the record.
 * @param env - The control-env overlay, or undefined when control is disabled.
 * @returns The caller's role, orchestrator unless the overlay says otherwise.
 */
function readControlRole(
	env: Record<string, string> | undefined,
): AgentControlRole {
	return env?.[CONTROL_ROLE_ENV_KEY] === SUBAGENT_ROLE
		? 'subagent'
		: 'orchestrator';
}

/**
 * Lifts the loopback control endpoint out of the overlay.
 * @param env - The control-env overlay, or undefined when control is disabled.
 * @returns The endpoint, or null when the control server is not up.
 */
function readControlMcp(
	env: Record<string, string> | undefined,
): AgentControlMcpConfig | null {
	const url = env?.[CONTROL_URL_ENV_KEY];
	const token = env?.[CONTROL_TOKEN_ENV_KEY];
	return url && token ? { token, url } : null;
}

/**
 * Registers the session's control origin under its runtime's species and
 * resolves the request fields that follow from it.
 *
 * The playbook is withheld whenever the endpoint is — a session that cannot
 * reach the control server holds none of the `ensemblr_*` tools the playbook
 * describes, and an inventory of absent tools only sends a model hunting.
 *
 * The turn preamble rides alongside the playbook for the same runtimes and the
 * same reason Pi does not need it: Pi's extension pulls its own blocks before
 * every turn, while a runtime the app drives over MCP has its system prompt
 * fixed at session open and would otherwise never hear about naming the session
 * still owes, nor about a language switched since it opened.
 * @param input - Session identity, its runtime, the env resolver, the delegation-mode and sub-agent-marker readers, and the turn-preamble resolver.
 * @returns The env overlay plus the MCP endpoint, playbook, delegation mechanism, and turn preamble, where they apply.
 */
export function resolveAgentControlWiring({
	isSpawnedSubAgent,
	parentSessionId,
	provider,
	readClaudeSubagentMode,
	resolveAgentControlEnv,
	resolveTurnPreamble,
	sessionId,
	workspaceId,
}: {
	isSpawnedSubAgent: SubAgentMarkerReader | undefined;
	parentSessionId: string | null;
	provider: AgentProviderId;
	readClaudeSubagentMode: SubagentMechanismReader | undefined;
	resolveAgentControlEnv: AgentControlEnvResolver | undefined;
	resolveTurnPreamble: TurnPreambleResolver | undefined;
	sessionId: string;
	workspaceId: string;
}): AgentControlWiring {
	const delegation = resolveDelegation({
		isSpawnedSubAgent,
		parentSessionId,
		provider,
		readClaudeSubagentMode,
		sessionId,
	});
	const env = resolveAgentControlEnv?.({
		delegation,
		parentSessionId,
		sessionId,
		species: speciesForProvider(provider),
		workspaceId,
	});

	const controlMcp = NATIVE_MCP_PROVIDERS.has(provider)
		? readControlMcp(env)
		: null;
	if (!controlMcp) {
		return {
			controlMcp: null,
			delegation,
			env,
			resolveTurnPreamble: null,
			systemPromptAppend: null,
		};
	}

	return {
		controlMcp,
		delegation,
		env,
		resolveTurnPreamble: resolveTurnPreamble
			? () => resolveTurnPreamble(sessionId)
			: null,
		systemPromptAppend: awarenessForAudience({
			delegation,
			hasChatTab: true,
			role: readControlRole(env),
		}),
	};
}
