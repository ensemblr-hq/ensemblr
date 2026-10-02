import {
	type AgentProviderId,
	DEFAULT_AGENT_PROVIDER,
} from '../../shared/agent-provider.ts';
import type { PiExecutableSnapshot } from './pi-executable.ts';

/**
 * Whether an open has to wait on Pi's executable. Only the runtime this snapshot
 * describes is gated on it: keying the check on "is not Claude" would block every
 * runtime added after Claude on a binary it never launches, though each resolves
 * its own executable at open time. A provider the catalog could not resolve is
 * gated too, because the opener falls back to Pi for it.
 *
 * Shared by both open routes — the renderer's own request and an orchestrator's
 * delegated spawn — so neither can start gating on a binary the other ignores.
 * Reached by module path rather than through `pi-runtime`'s barrel, which carries
 * the runtime's service factories and not its helpers.
 * @param input - The provider the open resolved to, and Pi's current executable snapshot.
 * @returns True when the session cannot open until Pi's setup checks are resolved.
 */
export function isBlockedByPiExecutable({
	executable,
	provider,
}: {
	executable: PiExecutableSnapshot;
	provider: AgentProviderId | null;
}): boolean {
	if ((provider ?? DEFAULT_AGENT_PROVIDER) !== DEFAULT_AGENT_PROVIDER) {
		return false;
	}
	return executable.status === 'error' || !executable.command;
}
