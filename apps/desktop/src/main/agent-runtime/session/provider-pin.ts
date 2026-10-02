import {
	type AgentProviderId,
	getAgentProviderLabel,
} from '../../../shared/agent-provider.ts';
import { AgentSessionServiceError } from '../agent-session-service-error.ts';

/**
 * Rejects a request whose model belongs to a different agent runtime than the
 * one the session was opened on. A chat is pinned to its runtime for life: the
 * two speak different native session formats, so crossing providers mid-chat
 * would hand the new runtime a history it cannot resume.
 *
 * The check is main-side on purpose. The picker already disables other
 * providers' models, but only this stops a stale window — or a renderer that
 * skipped the picker entirely — from crossing the pin.
 * @param input - The session's pinned runtime and the runtime the requested model needs; a `requested` of `null` states no opinion and leaves the pin alone.
 */
export function assertProviderPin({
	pinned,
	requested,
}: {
	pinned: AgentProviderId;
	requested: AgentProviderId | null | undefined;
}): void {
	if (!requested || requested === pinned) {
		return;
	}
	throw new AgentSessionServiceError({
		code: 'provider-mismatch',
		message: `This chat runs on ${getAgentProviderLabel(pinned)}; the selected model needs ${getAgentProviderLabel(requested)}. Start a new chat to switch provider.`,
	});
}
