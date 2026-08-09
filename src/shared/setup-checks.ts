import type { AgentProviderId } from './agent-provider.ts';
import type { SetupCheckId, SetupCheckStatus } from './ipc/contracts/setup';

/**
 * The checks that make up each agent runtime's readiness, keyed by provider.
 * Ensemblr needs *an* agent runtime, not a particular one, so these are gated
 * against each other rather than individually.
 *
 * Both gates read this one table: the setup-diagnostics rollup resolves it onto
 * each check's `blocking` flag, and the onboarding wizard rolls each group up
 * into a single runtime card. Two hand-written copies would let the wizard call
 * a machine ready that diagnostics still reports as blocked.
 */
export const AGENT_RUNTIME_CHECK_GROUPS = {
	claude: ['claude-executable'],
	pi: ['pi-executable', 'pi-agent-directory', 'pi-rpc', 'pi-provider-model'],
} as const satisfies Record<AgentProviderId, readonly SetupCheckId[]>;

/**
 * True when a check status counts as a pass. `warning` passes because it marks
 * a degraded but usable result — a Pi binary that runs but whose version probe
 * needs attention still opens chats, and a surface that treated it as a failure
 * would block a machine the rest of the app considers ready.
 * @param status - The status a check reported.
 * @returns True when the check should not hold a gate closed.
 */
export function isPassingSetupStatus(status: SetupCheckStatus): boolean {
	return status === 'success' || status === 'warning';
}
