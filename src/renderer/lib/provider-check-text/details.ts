import type { TFunction } from 'i18next';

import {
	piAgentDirectorySourceLabel,
	piExecutableSourceLabel,
} from '@/renderer/lib/setup-check-text';
import { getAgentProviderDescriptor } from '@/shared/agent-provider';
import type { AgentProviderDetailCode } from '@/shared/ipc/contracts/agent-provider';
import type { SetupMessageParams } from '@/shared/ipc/contracts/setup';

const CLAUDE = getAgentProviderDescriptor('claude');

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

/**
 * Readiness detail per authored code. A `Record` over the union rather than a
 * `switch` so a code added in a probe is a missing-key compile error here.
 */
export const PROVIDER_DETAIL_TEXT: Record<
	AgentProviderDetailCode,
	(t: TFunction, params: SetupMessageParams) => string
> = {
	'account-identity': (t, params) =>
		t('settings:providers.detail.account-identity', '{{identity}}.', params),
	'account-identity-with-plan': (t, params) =>
		t(
			'settings:providers.detail.account-identity-with-plan',
			'{{identity}} ({{plan}}).',
			params,
		),
	'account-signed-in': (t) =>
		t('settings:providers.detail.account-signed-in', 'Signed in.'),
	'account-signed-in-with-plan': (t, params) =>
		t(
			'settings:providers.detail.account-signed-in-with-plan',
			'Signed in ({{plan}}).',
			params,
		),
	'claude-executable-override-broken': (t) =>
		t(
			'settings:providers.detail.claude-executable-override-broken',
			'The configured {{provider}} executable could not be run. Clear the override to fall back to the {{command}} on your PATH, or pick a runnable binary.',
			{ command: CLAUDE.executableCommand, provider: CLAUDE.label },
		),
	'claude-no-executable': (t) =>
		t(
			'settings:providers.detail.claude-no-executable',
			'No {{command}} executable was found on your PATH. Ensemblr does not ship {{provider}}: install it, run {{loginCommand}}, then re-run these checks.',
			{
				command: CLAUDE.executableCommand,
				loginCommand: claudeLoginCommand(t),
				provider: CLAUDE.label,
			},
		),
	'claude-not-signed-in': (t) =>
		t(
			'settings:providers.detail.claude-not-signed-in',
			'{{provider}} is installed but not signed in.',
			{ provider: CLAUDE.label },
		),
	'claude-session-timeout': (t, params) =>
		t(
			'settings:providers.detail.claude-session-timeout',
			'{{provider}} started but did not answer within {{seconds}}s. Run {{command}} in a terminal to clear any pending login or Keychain prompt, then re-run these checks.',
			{
				command: CLAUDE.executableCommand,
				provider: CLAUDE.label,
				seconds: params.seconds,
			},
		),
	'claude-version-no-executable': (t) =>
		t(
			'settings:providers.detail.claude-version-no-executable',
			'There is no {{command}} binary to version-probe. Install {{provider}}, run {{loginCommand}}, then re-run these checks.',
			{
				command: CLAUDE.executableCommand,
				loginCommand: claudeLoginCommand(t),
				provider: CLAUDE.label,
			},
		),
	'executable-configured': (t, params) =>
		t(
			'settings:providers.detail.executable-configured',
			'Configured override: {{path}}.',
			params,
		),
	'executable-on-path': (t, params) =>
		t(
			'settings:providers.detail.executable-on-path',
			'Found on PATH: {{path}}.',
			params,
		),
	'mcp-connected': (t, params) =>
		t('settings:providers.detail.mcp-connected', {
			count: Number(params.count ?? 0),
			defaultValue_one: '{{count}} MCP server connected.',
			defaultValue_other: '{{count}} MCP servers connected.',
		}),
	'mcp-none': (t) =>
		t('settings:providers.detail.mcp-none', 'No MCP servers are configured.'),
	'mcp-unhealthy': (t, params) =>
		t('settings:providers.detail.mcp-unhealthy', '{{servers}}', params),
	'mcp-unlistable': (t) =>
		t(
			'settings:providers.detail.mcp-unlistable',
			'MCP servers could not be listed because the runtime did not report them.',
		),
	'pi-agent-directory-resolved': (t, params) =>
		t(
			'settings:providers.detail.pi-agent-directory-resolved',
			'{{path}} ({{source}}).',
			{
				path: params.path,
				source: piAgentDirectorySourceLabel(params.source, t),
			},
		),
	'pi-agent-directory-unverified': (t, params) =>
		t(
			'settings:providers.detail.pi-agent-directory-unverified',
			"{{provider}}'s agent directory could not be verified.",
			params,
		),
	'pi-executable-resolved': (t, params) =>
		t(
			'settings:providers.detail.pi-executable-resolved',
			'{{path}} ({{source}}).',
			{ path: params.path, source: piExecutableSourceLabel(params.source, t) },
		),
	'pi-executable-undiscovered': (t, params) =>
		t(
			'settings:providers.detail.pi-executable-undiscovered',
			'{{provider}} could not be discovered. Install it or select a compatible executable.',
			params,
		),
	'pi-models-ready': (t, params) =>
		t(
			'settings:providers.detail.pi-models-ready',
			'{{modelCount}} models across {{providerCount}} providers.',
			params,
		),
	'pi-models-unverified': (t) =>
		t(
			'settings:providers.detail.pi-models-unverified',
			'Provider and model readiness could not be verified.',
		),
	'pi-rpc-invalid': (t, params) =>
		t(
			'settings:providers.detail.pi-rpc-invalid',
			'{{provider}} RPC startup did not produce valid JSONL.',
			params,
		),
	'pi-rpc-ready': (t, params) =>
		t(
			'settings:providers.detail.pi-rpc-ready',
			'Startup produced a valid {{frameType}} frame.',
			params,
		),
	'version-command-failed': (t, params) =>
		t(
			'settings:providers.detail.version-command-failed',
			'{{command}} --version failed: {{message}}',
			params,
		),
	'version-command-failed-unknown': (t, params) =>
		t(
			'settings:providers.detail.version-command-failed-unknown',
			'{{command}} --version failed for an unknown reason.',
			params,
		),
};
