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

/** Resolves everything the app prepends to one agent session's turn. */
export type TurnPreambleResolver = (
	sessionId: string,
) => Promise<string | null>;

/** What the agent-control layer contributes to one session's open request. */
export interface AgentControlWiring {
	controlMcp: AgentControlMcpConfig | null;
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
 * @param input - Session identity, its runtime, the env resolver, and the turn-preamble resolver.
 * @returns The env overlay plus the MCP endpoint, playbook, and turn preamble, where they apply.
 */
export function resolveAgentControlWiring({
	parentSessionId,
	provider,
	resolveAgentControlEnv,
	resolveTurnPreamble,
	sessionId,
	workspaceId,
}: {
	parentSessionId: string | null;
	provider: AgentProviderId;
	resolveAgentControlEnv: AgentControlEnvResolver | undefined;
	resolveTurnPreamble: TurnPreambleResolver | undefined;
	sessionId: string;
	workspaceId: string;
}): AgentControlWiring {
	const env = resolveAgentControlEnv?.({
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
			env,
			resolveTurnPreamble: null,
			systemPromptAppend: null,
		};
	}

	return {
		controlMcp,
		env,
		resolveTurnPreamble: resolveTurnPreamble
			? () => resolveTurnPreamble(sessionId)
			: null,
		systemPromptAppend: awarenessForAudience({
			hasChatTab: true,
			role: readControlRole(env),
		}),
	};
}
