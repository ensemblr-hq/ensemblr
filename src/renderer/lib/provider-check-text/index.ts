import type { TFunction } from 'i18next';

import { PROVIDER_DETAIL_TEXT } from '@/renderer/lib/provider-check-text/details';
import {
	type AgentProviderId,
	getAgentProviderDescriptor,
} from '@/shared/agent-provider';
import type { AgentProviderCheckWire } from '@/shared/ipc/contracts/agent-provider';

/** Row label per readiness check id, for the ids both probes share. */
const PROVIDER_CHECK_LABEL: Record<
	string,
	(t: TFunction, provider: AgentProviderId) => string
> = {
	'agent-directory': (t) =>
		t('settings:providers.check.agent-directory', 'Agent directory'),
	auth: (t) => t('settings:providers.check.auth', 'Authentication'),
	executable: (t, provider) =>
		t('settings:providers.check.executable', '{{provider}} executable', {
			provider: getAgentProviderDescriptor(provider).label,
		}),
	mcp: (t) => t('settings:providers.check.mcp', 'MCP servers'),
	'provider-models': (t) =>
		t('settings:providers.check.provider-models', 'Providers and models'),
	'rpc-smoke': (t) => t('settings:providers.check.rpc-smoke', 'RPC startup'),
	version: (t) => t('settings:providers.check.version', 'Version'),
};

/**
 * Names one readiness check for the Providers page. The wire carries the English
 * label for the diagnostics bundle; the page renders the translation keyed by
 * check id, with the runtime's own name folded in where the row is about it.
 * @param check - The check being named.
 * @param provider - Runtime whose tab is rendering the row.
 * @param t - Translator from the calling component.
 * @returns The row label.
 */
export function providerCheckLabel(
	check: Pick<AgentProviderCheckWire, 'id' | 'label'>,
	provider: AgentProviderId,
	t: TFunction,
): string {
	return PROVIDER_CHECK_LABEL[check.id]?.(t, provider) ?? check.label;
}

/**
 * Renders a readiness check's detail line in the app language, falling back to
 * the English text when the probe passed an upstream message through — a runtime
 * error or a reported version string is not ours to translate.
 * @param check - The check whose detail to render.
 * @param t - Translator from the calling component.
 * @returns The detail line, or null when the check reported none.
 */
export function providerCheckDetail(
	check: Pick<AgentProviderCheckWire, 'detail' | 'detailMessage'>,
	t: TFunction,
): string | null {
	const message = check.detailMessage;

	return message
		? PROVIDER_DETAIL_TEXT[message.code](t, message.params ?? {})
		: check.detail;
}
