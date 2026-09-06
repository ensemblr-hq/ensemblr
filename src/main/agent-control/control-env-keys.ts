/**
 * Env var names carrying the agent-control overlay into a spawned agent.
 *
 * Named once here because three unrelated call sites depend on the exact
 * spelling: the resolver that writes the overlay, the harness launch decoration
 * that references the token var by name inside `--mcp-config`, and the native
 * Claude adapter that does the same through the Agent SDK. A drifted spelling
 * in any one of them silently downgrades to an unauthenticated control client.
 */

/** Env var carrying the loopback control server's base URL. */
export const CONTROL_URL_ENV_KEY = 'ENSEMBLR_CONTROL_URL';

/** Env var carrying the per-workspace control token in an agent process. */
export const CONTROL_TOKEN_ENV_KEY = 'ENSEMBLR_CONTROL_TOKEN';

/** Env var carrying the caller's resolved control role. */
export const CONTROL_ROLE_ENV_KEY = 'ENSEMBLR_CONTROL_ROLE';

/**
 * Env var telling the Pi extension whether the architecture diagram feature is
 * on. The extension registers its own tools and injects its own playbook, so it
 * has to be told: the MCP endpoint's tool list and the playbooks the app serves
 * never reach it. Set to `1` when on, absent otherwise.
 */
export const CONTROL_ARCHITECTURE_ENV_KEY = 'ENSEMBLR_CONTROL_ARCHITECTURE';

/** The value {@link CONTROL_ARCHITECTURE_ENV_KEY} carries when the feature is on. */
export const CONTROL_ARCHITECTURE_ENABLED = '1';

/**
 * Env var telling the Pi extension whether third-party CLI harnesses are on, for
 * the reason {@link CONTROL_ARCHITECTURE_ENV_KEY} exists: the extension registers
 * its own tools and injects its own playbook, so neither the app's tool list nor
 * its playbooks reach it. Set to `1` when on, absent otherwise.
 */
export const CONTROL_TUI_HARNESSES_ENV_KEY = 'ENSEMBLR_CONTROL_TUI_HARNESSES';

/** The value {@link CONTROL_TUI_HARNESSES_ENV_KEY} carries when the feature is on. */
export const CONTROL_TUI_HARNESSES_ENABLED = '1';

/**
 * Renders a shell-style reference to an env var, for configs the agent's own
 * CLI expands at launch. Passing the reference instead of the value keeps the
 * secret out of the child's argv, where any process on the machine can read it.
 * @param key - Env var name to reference.
 * @returns The `${NAME}` reference string.
 */
export function envVarReference(key: string): string {
	return `\${${key}}`;
}
