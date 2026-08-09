import type { TFunction } from 'i18next';

import {
	piAgentDirectorySourceLabel,
	piExecutableSourceLabel,
} from '@/renderer/lib/setup-check-text/source-labels';
import { getAgentProviderDescriptor } from '@/shared/agent-provider';
import type {
	SetupDetailCode,
	SetupMessageParams,
} from '@/shared/ipc/contracts/setup';

const CLAUDE = getAgentProviderDescriptor('claude');

/**
 * Detail line per authored code. A `Record` over the union rather than a
 * `switch` so a code added in main is a missing-key compile error here, and so
 * the sixty-odd entries cost one property read instead of a branch each.
 */
export const SETUP_DETAIL_TEXT: Record<
	SetupDetailCode,
	(t: TFunction, params: SetupMessageParams) => string
> = {
	'claude-executable-not-found': (t) =>
		t(
			'common:setup-check.detail.claude-executable-not-found',
			'{{provider}} was not found in the shell-derived PATH. Ensemblr does not ship it: install {{provider}}, then retry.',
			{ provider: CLAUDE.label },
		),
	'claude-executable-on-path': (t, params) =>
		t(
			'common:setup-check.detail.claude-executable-on-path',
			'Found on PATH: {{path}}.',
			params,
		),
	'claude-executable-override': (t, params) =>
		t(
			'common:setup-check.detail.claude-executable-override',
			'Configured override: {{path}}.',
			params,
		),
	'claude-executable-override-broken': (t) =>
		t(
			'common:setup-check.detail.claude-executable-override-broken',
			'The configured {{provider}} executable could not be run. Clear the override to fall back to the {{command}} on your PATH, or pick a runnable binary.',
			{ command: CLAUDE.executableCommand, provider: CLAUDE.label },
		),
	'claude-unknown-error': (t) =>
		t(
			'common:setup-check.detail.claude-unknown-error',
			'Unknown {{provider}} executable check error.',
			{ provider: CLAUDE.label },
		),
	'config-loaded': (t) =>
		t('common:setup-check.detail.config-loaded', 'Declarative config loaded.'),
	'config-missing': (t) =>
		t(
			'common:setup-check.detail.config-missing',
			'No declarative config file was found; built-in defaults are active.',
		),
	'database-open-failed': (t, params) =>
		t(
			'common:setup-check.detail.database-open-failed',
			'SQLite failed to open at {{path}}.',
			params,
		),
	'database-ready': (t, params) =>
		t(
			'common:setup-check.detail.database-ready',
			'SQLite opened at {{path}}; schema version {{schemaVersion}}.',
			params,
		),
	'environment-cataloged': (t, params) =>
		t(
			'common:setup-check.detail.environment-cataloged',
			'{{configured}} configured variables, {{masked}} masked secrets, and {{reserved}} reserved runtime variables are cataloged.',
			params,
		),
	'environment-missing-required': (t, params) =>
		t('common:setup-check.detail.environment-missing-required', {
			count: Number(params.count ?? 0),
			defaultValue_one: '{{count}} required environment variable is unset.',
			defaultValue_other: '{{count}} required environment variables are unset.',
		}),
	'environment-unknown-error': (t) =>
		t(
			'common:setup-check.detail.environment-unknown-error',
			'Unknown environment variable check error.',
		),
	'gh-auth-cli-not-found': (t) =>
		t(
			'common:setup-check.detail.gh-auth-cli-not-found',
			'GitHub CLI was not found before authentication could be checked. Install gh, then retry.',
		),
	'gh-auth-output-truncated': (t) =>
		t(
			'common:setup-check.detail.gh-auth-output-truncated',
			'GitHub authentication check produced too much output.',
		),
	'gh-auth-ready': (t, params) =>
		t(
			'common:setup-check.detail.gh-auth-ready',
			'GitHub CLI is authenticated for {{hostname}}.',
			params,
		),
	'gh-auth-required': (t, params) =>
		t(
			'common:setup-check.detail.gh-auth-required',
			'GitHub CLI is not authenticated for {{hostname}}. Run gh auth login --hostname {{hostname}}, then retry.',
			params,
		),
	'gh-auth-timeout': (t, params) =>
		t(
			'common:setup-check.detail.gh-auth-timeout',
			'GitHub authentication check timed out for {{hostname}}.',
			params,
		),
	'gh-auth-unknown-error': (t) =>
		t(
			'common:setup-check.detail.gh-auth-unknown-error',
			'Unknown GitHub auth check error.',
		),
	'gh-cli-available': (t, params) =>
		t(
			'common:setup-check.detail.gh-cli-available',
			'GitHub CLI is available: {{version}}.',
			params,
		),
	'gh-cli-available-unknown-version': (t) =>
		t(
			'common:setup-check.detail.gh-cli-available-unknown-version',
			'GitHub CLI is available.',
		),
	'gh-cli-failed': (t, params) =>
		t(
			'common:setup-check.detail.gh-cli-failed',
			'GitHub CLI version check failed: {{message}}',
			params,
		),
	'gh-cli-failed-unknown': (t) =>
		t(
			'common:setup-check.detail.gh-cli-failed-unknown',
			'GitHub CLI version check failed for an unknown reason.',
		),
	'gh-cli-not-found': (t) =>
		t(
			'common:setup-check.detail.gh-cli-not-found',
			'GitHub CLI was not found in the shell-derived PATH. Install gh, then retry.',
		),
	'gh-cli-output-truncated': (t) =>
		t(
			'common:setup-check.detail.gh-cli-output-truncated',
			'GitHub CLI version check produced too much output.',
		),
	'gh-cli-timeout': (t) =>
		t(
			'common:setup-check.detail.gh-cli-timeout',
			'GitHub CLI version check timed out.',
		),
	'gh-cli-unknown-error': (t) =>
		t(
			'common:setup-check.detail.gh-cli-unknown-error',
			'Unknown GitHub CLI check error.',
		),
	'git-available': (t, params) =>
		t(
			'common:setup-check.detail.git-available',
			'Git is available: {{version}}.',
			params,
		),
	'git-available-unknown-version': (t) =>
		t(
			'common:setup-check.detail.git-available-unknown-version',
			'Git is available.',
		),
	'git-failed': (t, params) =>
		t(
			'common:setup-check.detail.git-failed',
			'Git version check failed: {{message}}',
			params,
		),
	'git-failed-unknown': (t) =>
		t(
			'common:setup-check.detail.git-failed-unknown',
			'Git version check failed for an unknown reason.',
		),
	'git-not-found': (t) =>
		t(
			'common:setup-check.detail.git-not-found',
			'Git was not found in the shell-derived PATH. Install Git or Xcode Command Line Tools, then retry.',
		),
	'git-output-truncated': (t) =>
		t(
			'common:setup-check.detail.git-output-truncated',
			'Git version check produced too much output.',
		),
	'git-timeout': (t) =>
		t('common:setup-check.detail.git-timeout', 'Git version check timed out.'),
	'git-unknown-error': (t) =>
		t(
			'common:setup-check.detail.git-unknown-error',
			'Unknown git check error.',
		),
	'linear-connected': (t) =>
		t('common:setup-check.detail.linear-connected', 'Linear is connected.'),
	'linear-connected-as': (t, params) =>
		t(
			'common:setup-check.detail.linear-connected-as',
			'Linear is connected as {{identity}}.',
			params,
		),
	'linear-connected-with-organization': (t, params) =>
		t(
			'common:setup-check.detail.linear-connected-with-organization',
			'Linear is connected as {{identity}} ({{organization}}).',
			params,
		),
	'linear-not-configured': (t) =>
		t(
			'common:setup-check.detail.linear-not-configured',
			'Linear OAuth is not configured. Add app.linear.clientId to the Ensemblr config to enable Linear workflows. Linear is optional for local and GitHub-only workflows.',
		),
	'linear-not-connected': (t) =>
		t(
			'common:setup-check.detail.linear-not-connected',
			'Linear is not connected. Sign in from integration settings to enable Linear workflows.',
		),
	'linear-reconnect-required': (t) =>
		t(
			'common:setup-check.detail.linear-reconnect-required',
			'The stored Linear token expired and cannot be refreshed. Reconnect Linear from integration settings.',
		),
	'linear-unknown-error': (t) =>
		t(
			'common:setup-check.detail.linear-unknown-error',
			'Unknown Linear check error.',
		),
	'managed-directories-attention': (t, params) =>
		t(
			'common:setup-check.detail.managed-directories-attention',
			'Managed directories need attention: {{keys}}.',
			params,
		),
	'managed-directories-ready': (t) =>
		t(
			'common:setup-check.detail.managed-directories-ready',
			'Managed repos, workspaces, and archived-contexts directories are ready.',
		),
	'pi-agent-directory-ready': (t, params) =>
		t(
			'common:setup-check.detail.pi-agent-directory-ready',
			'Pi agent directory resolves from {{source}}: {{path}}.',
			{
				path: params.path,
				source: piAgentDirectorySourceLabel(params.source, t),
			},
		),
	'pi-agent-directory-unknown-error': (t) =>
		t(
			'common:setup-check.detail.pi-agent-directory-unknown-error',
			'Unknown Pi agent directory check error.',
		),
	'pi-agent-directory-unverified': (t) =>
		t(
			'common:setup-check.detail.pi-agent-directory-unverified',
			'Pi agent directory could not be verified. Fix the Pi environment path or directory permissions, then retry.',
		),
	'pi-executable-not-found': (t) =>
		t(
			'common:setup-check.detail.pi-executable-not-found',
			'Pi executable could not be discovered. Install Pi, select a compatible executable or wrapper, then retry.',
		),
	'pi-executable-probe-warning': (t, params) =>
		t(
			'common:setup-check.detail.pi-executable-probe-warning',
			'Pi executable is present at {{path}}, but version/help probing needs attention.',
			params,
		),
	'pi-executable-ready-no-probe': (t, params) =>
		t(
			'common:setup-check.detail.pi-executable-ready-no-probe',
			'Pi executable selected from {{source}}: {{path}}. No version/help probe ran.',
			{ path: params.path, source: piExecutableSourceLabel(params.source, t) },
		),
	'pi-executable-ready-with-probe': (t, params) =>
		t(
			'common:setup-check.detail.pi-executable-ready-with-probe',
			'Pi executable selected from {{source}}: {{path}}. {{probeKind}} probe returned: {{probeDetail}}',
			{
				path: params.path,
				probeDetail: params.probeDetail,
				probeKind: params.probeKind,
				source: piExecutableSourceLabel(params.source, t),
			},
		),
	'pi-executable-unknown-error': (t) =>
		t(
			'common:setup-check.detail.pi-executable-unknown-error',
			'Unknown Pi executable check error.',
		),
	'pi-models-ready': (t, params) =>
		t(
			'common:setup-check.detail.pi-models-ready',
			'Pi listed {{modelCount}} models across {{providerCount}} providers.',
			params,
		),
	'pi-models-unknown-error': (t) =>
		t(
			'common:setup-check.detail.pi-models-unknown-error',
			'Unknown Pi provider/model check error.',
		),
	'pi-models-unverified': (t) =>
		t(
			'common:setup-check.detail.pi-models-unverified',
			'Pi provider/model readiness could not be verified.',
		),
	'pi-rpc-invalid': (t) =>
		t(
			'common:setup-check.detail.pi-rpc-invalid',
			'Pi RPC startup did not produce valid JSONL.',
		),
	'pi-rpc-ready': (t, params) =>
		t(
			'common:setup-check.detail.pi-rpc-ready',
			'Pi RPC startup produced a valid {{frameType}} frame from {{cwd}}.',
			params,
		),
	'pi-rpc-unknown-error': (t) =>
		t(
			'common:setup-check.detail.pi-rpc-unknown-error',
			'Unknown Pi RPC check error.',
		),
	'root-directory-ready': (t, params) =>
		t(
			'common:setup-check.detail.root-directory-ready',
			'Ensemblr root is ready at {{path}}.',
			params,
		),
	'shell-fallback-environment': (t) =>
		t(
			'common:setup-check.detail.shell-fallback-environment',
			'Commands launch successfully, but shell environment resolution used a fallback.',
		),
	'shell-ready': (t) =>
		t(
			'common:setup-check.detail.shell-ready',
			'Commands launch successfully with the shell-derived environment.',
		),
	'shell-smoke-failed': (t) =>
		t(
			'common:setup-check.detail.shell-smoke-failed',
			'The process launch smoke check failed.',
		),
	'shell-unknown-error': (t) =>
		t(
			'common:setup-check.detail.shell-unknown-error',
			'Unknown process error.',
		),
	'unknown-check-error': (t) =>
		t('common:setup-check.detail.unknown-check-error', 'Unknown check error.'),
};
