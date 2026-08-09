import type { TFunction } from 'i18next';

import { piExecutableSourceLabel } from '@/renderer/lib/setup-check-text';
import {
	type AgentProviderId,
	getAgentProviderDescriptor,
} from '@/shared/agent-provider';
import type {
	AgentProviderCheckWire,
	AgentProviderDetailMessage,
} from '@/shared/ipc/contracts/agent-provider';

const CLAUDE = getAgentProviderDescriptor('claude');

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
	switch (check.id) {
		case 'agent-directory':
			return t('settings:providers.check.agent-directory', 'Agent directory');
		case 'auth':
			return t('settings:providers.check.auth', 'Authentication');
		case 'executable':
			return t(
				'settings:providers.check.executable',
				'{{provider}} executable',
				{
					provider: getAgentProviderDescriptor(provider).label,
				},
			);
		case 'mcp':
			return t('settings:providers.check.mcp', 'MCP servers');
		case 'provider-models':
			return t(
				'settings:providers.check.provider-models',
				'Providers and models',
			);
		case 'rpc-smoke':
			return t('settings:providers.check.rpc-smoke', 'RPC startup');
		case 'version':
			return t('settings:providers.check.version', 'Version');
		default:
			return check.label;
	}
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
	return check.detailMessage
		? providerDetailText(check.detailMessage, t)
		: check.detail;
}

/**
 * Resolves one authored readiness code against the catalogue, interpolating the
 * values the probe measured.
 * @param message - The code and values the probe sent.
 * @param t - Translator from the calling component.
 * @returns The localized detail line.
 */
function providerDetailText(
	message: AgentProviderDetailMessage,
	t: TFunction,
): string {
	const params = message.params ?? {};

	switch (message.code) {
		case 'account-identity':
			return t(
				'settings:providers.detail.account-identity',
				'{{identity}}.',
				params,
			);
		case 'account-identity-with-plan':
			return t(
				'settings:providers.detail.account-identity-with-plan',
				'{{identity}} ({{plan}}).',
				params,
			);
		case 'account-signed-in':
			return t('settings:providers.detail.account-signed-in', 'Signed in.');
		case 'account-signed-in-with-plan':
			return t(
				'settings:providers.detail.account-signed-in-with-plan',
				'Signed in ({{plan}}).',
				params,
			);
		case 'claude-executable-override-broken':
			return t(
				'settings:providers.detail.claude-executable-override-broken',
				'The configured {{provider}} executable could not be run. Clear the override to fall back to the {{command}} on your PATH, or pick a runnable binary.',
				{ command: CLAUDE.executableCommand, provider: CLAUDE.label },
			);
		case 'claude-no-executable':
			return t(
				'settings:providers.detail.claude-no-executable',
				'No {{command}} executable was found on your PATH. Ensemblr does not ship {{provider}}: install it, run {{loginCommand}}, then re-run these checks.',
				{
					command: CLAUDE.executableCommand,
					loginCommand: claudeLoginCommand(t),
					provider: CLAUDE.label,
				},
			);
		case 'claude-not-signed-in':
			return t(
				'settings:providers.detail.claude-not-signed-in',
				'{{provider}} is installed but not signed in.',
				{ provider: CLAUDE.label },
			);
		case 'claude-session-timeout':
			return t(
				'settings:providers.detail.claude-session-timeout',
				'{{provider}} started but did not answer within {{seconds}}s. Run {{command}} in a terminal to clear any pending login or Keychain prompt, then re-run these checks.',
				{
					command: CLAUDE.executableCommand,
					provider: CLAUDE.label,
					seconds: params.seconds,
				},
			);
		case 'claude-version-no-executable':
			return t(
				'settings:providers.detail.claude-version-no-executable',
				'There is no {{command}} binary to version-probe. Install {{provider}}, run {{loginCommand}}, then re-run these checks.',
				{
					command: CLAUDE.executableCommand,
					loginCommand: claudeLoginCommand(t),
					provider: CLAUDE.label,
				},
			);
		case 'executable-configured':
			return t(
				'settings:providers.detail.executable-configured',
				'Configured override: {{path}}.',
				params,
			);
		case 'executable-on-path':
			return t(
				'settings:providers.detail.executable-on-path',
				'Found on PATH: {{path}}.',
				params,
			);
		case 'mcp-connected':
			return t('settings:providers.detail.mcp-connected', {
				count: Number(params.count ?? 0),
				defaultValue_one: '{{count}} MCP server connected.',
				defaultValue_other: '{{count}} MCP servers connected.',
			});
		case 'mcp-none':
			return t(
				'settings:providers.detail.mcp-none',
				'No MCP servers are configured.',
			);
		case 'mcp-unhealthy':
			return t(
				'settings:providers.detail.mcp-unhealthy',
				'{{servers}}',
				params,
			);
		case 'mcp-unlistable':
			return t(
				'settings:providers.detail.mcp-unlistable',
				'MCP servers could not be listed because the runtime did not report them.',
			);
		case 'pi-agent-directory-resolved':
			return t(
				'settings:providers.detail.pi-agent-directory-resolved',
				'{{path}} ({{source}}).',
				params,
			);
		case 'pi-agent-directory-unverified':
			return t(
				'settings:providers.detail.pi-agent-directory-unverified',
				"{{provider}}'s agent directory could not be verified.",
				params,
			);
		case 'pi-executable-resolved':
			return t(
				'settings:providers.detail.pi-executable-resolved',
				'{{path}} ({{source}}).',
				{
					path: params.path,
					source: piExecutableSourceLabel(params.source, t),
				},
			);
		case 'pi-executable-undiscovered':
			return t(
				'settings:providers.detail.pi-executable-undiscovered',
				'{{provider}} could not be discovered. Install it or select a compatible executable.',
				params,
			);
		case 'pi-models-ready':
			return t(
				'settings:providers.detail.pi-models-ready',
				'{{modelCount}} models across {{providerCount}} providers.',
				params,
			);
		case 'pi-models-unverified':
			return t(
				'settings:providers.detail.pi-models-unverified',
				'Provider and model readiness could not be verified.',
			);
		case 'pi-rpc-invalid':
			return t(
				'settings:providers.detail.pi-rpc-invalid',
				'{{provider}} RPC startup did not produce valid JSONL.',
				params,
			);
		case 'pi-rpc-ready':
			return t(
				'settings:providers.detail.pi-rpc-ready',
				'Startup produced a valid {{frameType}} frame.',
				params,
			);
		case 'version-command-failed':
			return t(
				'settings:providers.detail.version-command-failed',
				'{{command}} --version failed: {{message}}',
				params,
			);
		case 'version-command-failed-unknown':
			return t(
				'settings:providers.detail.version-command-failed-unknown',
				'{{command}} --version failed for an unknown reason.',
				params,
			);
	}
}

/**
 * Names the sign-in command in the install prompts. Claude declares one, but the
 * descriptor allows a runtime not to, and "its login command" has to translate.
 * @param t - Translator from the calling component.
 * @returns The command, or the phrase standing in for a runtime without one.
 */
function claudeLoginCommand(t: TFunction): string {
	return (
		CLAUDE.loginCommand ??
		t('settings:providers.detail.its-login-command', 'its login command')
	);
}
