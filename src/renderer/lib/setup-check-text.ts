import type { TFunction } from 'i18next';

import { getAgentProviderDescriptor } from '@/shared/agent-provider';
import type {
	SetupCheckId,
	SetupCheckLogSnapshot,
	SetupCheckSnapshot,
	SetupDetailMessage,
	SetupLogLabelMessage,
	SetupRemediationAction,
} from '@/shared/ipc/contracts/setup';

const CLAUDE = getAgentProviderDescriptor('claude');
const PI = getAgentProviderDescriptor('pi');

/**
 * Renders a setup check's title in the app language. The snapshot carries the
 * English source for the support bundle; every surface reads the translation
 * keyed by check id instead.
 * @param id - The check being named.
 * @param t - Translator from the calling component.
 * @returns The check title.
 */
export function setupCheckTitle(id: SetupCheckId, t: TFunction): string {
	switch (id) {
		case 'claude-executable':
			return t(
				'common:setup-check.title.claude-executable',
				'{{provider}} executable',
				{ provider: CLAUDE.label },
			);
		case 'config':
			return t('common:setup-check.title.config', 'Declarative config');
		case 'environment-variables':
			return t(
				'common:setup-check.title.environment-variables',
				'Environment variables',
			);
		case 'gh-auth':
			return t('common:setup-check.title.gh-auth', 'GitHub CLI authenticated');
		case 'gh-cli':
			return t('common:setup-check.title.gh-cli', 'GitHub CLI installed');
		case 'git-executable':
			return t('common:setup-check.title.git-executable', 'Git executable');
		case 'linear-oauth':
			return t('common:setup-check.title.linear-oauth', 'Linear connection');
		case 'managed-directories':
			return t(
				'common:setup-check.title.managed-directories',
				'Managed directories',
			);
		case 'pi-agent-directory':
			return t(
				'common:setup-check.title.pi-agent-directory',
				'Pi agent directory',
			);
		case 'pi-executable':
			return t('common:setup-check.title.pi-executable', 'Pi executable');
		case 'pi-provider-model':
			return t(
				'common:setup-check.title.pi-provider-model',
				'Pi provider and model readiness',
			);
		case 'pi-rpc':
			return t('common:setup-check.title.pi-rpc', 'Pi RPC startup');
		case 'root-directory':
			return t('common:setup-check.title.root-directory', 'Root directory');
		case 'shell-process-launch':
			return t(
				'common:setup-check.title.shell-process-launch',
				'Shell and process launch',
			);
		case 'sqlite-database':
			return t('common:setup-check.title.sqlite-database', 'SQLite database');
	}
}

/**
 * Renders a setup check's detail line in the app language, falling back to the
 * English text when the line passes an upstream message through — tool stderr
 * and thrown `Error` messages are not ours to translate.
 * @param check - The check whose detail to render.
 * @param t - Translator from the calling component.
 * @returns The detail line.
 */
export function setupCheckDetail(
	check: Pick<SetupCheckSnapshot, 'detail' | 'detailMessage'>,
	t: TFunction,
): string {
	return check.detailMessage
		? setupDetailText(check.detailMessage, t)
		: check.detail;
}

/**
 * Renders a remediation button's label in the app language. Retry actions the
 * catalogue does not name individually fall back to the generic retry label.
 * @param action - The remediation being labelled.
 * @param t - Translator from the calling component.
 * @returns The button label.
 */
export function setupRemediationLabel(
	action: SetupRemediationAction,
	t: TFunction,
): string {
	switch (action.id) {
		case 'choose-root-directory':
			return t(
				'common:setup-check.action.choose-root-directory',
				'Choose another root',
			);
		case 'install-claude-code':
			return t(
				'common:setup-check.action.install-claude-code',
				'Copy the {{provider}} install command',
				{ provider: CLAUDE.label },
			);
		case 'install-command-line-tools':
			return t(
				'common:setup-check.action.install-command-line-tools',
				'Install command-line tools',
			);
		case 'open-claude-setup-docs':
			return t(
				'common:setup-check.action.open-claude-setup-docs',
				'Open {{provider}} setup docs',
				{ provider: CLAUDE.label },
			);
		case 'open-config-settings':
			return t(
				'common:setup-check.action.open-config-settings',
				'Open config diagnostics',
			);
		case 'open-environment-settings':
			return t(
				'common:setup-check.action.open-environment-settings',
				'Open environment settings',
			);
		case 'open-gh-install':
			return t(
				'common:setup-check.action.open-gh-install',
				'Open GitHub CLI install docs',
			);
		case 'open-git-install':
			return t(
				'common:setup-check.action.open-git-install',
				'Open Git install docs',
			);
		case 'open-linear-settings':
			return t(
				'common:setup-check.action.open-linear-settings',
				'Open integration settings',
			);
		case 'open-pi-provider-settings':
			return t(
				'common:setup-check.action.open-pi-provider-settings',
				'Open Pi provider settings',
			);
		case 'retry-claude-executable':
			return t(
				'common:setup-check.action.retry-claude-executable',
				'Retry {{provider}} executable check',
				{ provider: CLAUDE.label },
			);
		case 'retry-config':
			return t('common:setup-check.action.retry-config', 'Retry config check');
		case 'retry-database':
			return t(
				'common:setup-check.action.retry-database',
				'Retry database check',
			);
		case 'retry-environment-variables':
			return t(
				'common:setup-check.action.retry-environment-variables',
				'Retry environment check',
			);
		case 'retry-gh-auth':
			return t(
				'common:setup-check.action.retry-gh-auth',
				'Retry GitHub auth check',
			);
		case 'retry-gh-cli':
			return t('common:setup-check.action.retry-gh-cli', 'Retry gh check');
		case 'retry-git-executable':
			return t(
				'common:setup-check.action.retry-git-executable',
				'Retry git check',
			);
		case 'retry-linear':
			return t('common:setup-check.action.retry-linear', 'Retry Linear check');
		case 'retry-managed-directories':
			return t(
				'common:setup-check.action.retry-managed-directories',
				'Retry directory check',
			);
		case 'retry-pi-agent-directory':
			return t(
				'common:setup-check.action.retry-pi-agent-directory',
				'Retry Pi agent directory check',
			);
		case 'retry-pi-executable':
			return t(
				'common:setup-check.action.retry-pi-executable',
				'Retry Pi executable check',
			);
		case 'retry-pi-provider-model':
			return t(
				'common:setup-check.action.retry-pi-provider-model',
				'Retry provider/model check',
			);
		case 'retry-pi-rpc':
			return t('common:setup-check.action.retry-pi-rpc', 'Retry Pi RPC check');
		case 'retry-claude-readiness':
			return t(
				'common:setup-check.action.rerun-provider-checks',
				'Re-run {{provider}} checks',
				{ provider: CLAUDE.label },
			);
		case 'retry-pi-readiness':
			return t(
				'common:setup-check.action.rerun-provider-checks',
				'Re-run {{provider}} checks',
				{ provider: PI.label },
			);
		case 'retry-root-directory':
			return t(
				'common:setup-check.action.retry-root-directory',
				'Retry root check',
			);
		case 'run-claude-login':
			return t(
				'common:setup-check.action.run-claude-login',
				'Run {{command}}',
				{ command: CLAUDE.loginCommand ?? '' },
			);
		case 'run-gh-auth-login':
			return t(
				'common:setup-check.action.run-gh-auth-login',
				'Run gh auth login',
			);
		case 'select-claude-executable':
			return t(
				'common:setup-check.action.select-claude-executable',
				'Select {{provider}} executable',
				{ provider: CLAUDE.label },
			);
		case 'select-pi-executable':
		case 'select-pi-executable-for-rpc':
			return t(
				'common:setup-check.action.select-pi-executable',
				'Select Pi executable',
			);
		default:
			return action.kind === 'retry'
				? t('common:setup-check.action.retry', 'Retry check')
				: action.label;
	}
}

/**
 * Renders a diagnostics-log label in the app language. Stream names and upstream
 * diagnostic codes arrive without a code and surface verbatim.
 * @param log - The log entry being labelled.
 * @param t - Translator from the calling component.
 * @returns The log label.
 */
export function setupLogLabel(
	log: Pick<SetupCheckLogSnapshot, 'label' | 'labelMessage'>,
	t: TFunction,
): string {
	return log.labelMessage ? setupLogLabelText(log.labelMessage, t) : log.label;
}

/**
 * Resolves one authored log-label code against the catalogue.
 * @param message - The code and values the setup layer sent.
 * @param t - Translator from the calling component.
 * @returns The localized label.
 */
function setupLogLabelText(
	message: SetupLogLabelMessage,
	t: TFunction,
): string {
	const params = message.params ?? {};

	switch (message.code) {
		case 'agent-directory-path':
			return t(
				'common:setup-check.log.agent-directory-path',
				'Agent directory path',
			);
		case 'catalog-entries':
			return t('common:setup-check.log.catalog-entries', 'Catalog entries');
		case 'command':
			return t('common:setup-check.log.command', 'Command');
		case 'config-diagnostic':
			return t('common:setup-check.log.config-diagnostic', 'Config diagnostic');
		case 'configured-variables':
			return t(
				'common:setup-check.log.configured-variables',
				'Configured variables',
			);
		case 'database-error':
			return t('common:setup-check.log.database-error', 'Database error');
		case 'database-path':
			return t('common:setup-check.log.database-path', 'Database path');
		case 'executable-path':
			return t('common:setup-check.log.executable-path', 'Executable path');
		case 'first-jsonl-frame':
			return t('common:setup-check.log.first-jsonl-frame', 'First JSONL frame');
		case 'masked-secrets':
			return t('common:setup-check.log.masked-secrets', 'Masked secrets');
		case 'model-count':
			return t('common:setup-check.log.model-count', 'Model count');
		case 'pi-probe':
			return t('common:setup-check.log.pi-probe', '{{kind}} probe', params);
		case 'provider-count':
			return t('common:setup-check.log.provider-count', 'Provider count');
		case 'reserved-runtime-variables':
			return t(
				'common:setup-check.log.reserved-runtime-variables',
				'Reserved runtime variables',
			);
		case 'root-path':
			return t('common:setup-check.log.root-path', 'Root path');
		case 'source':
			return t('common:setup-check.log.source', 'Source');
	}
}

/**
 * Resolves one authored detail code against the catalogue, interpolating the
 * values the setup layer measured.
 * @param message - The code and values the setup layer sent.
 * @param t - Translator from the calling component.
 * @returns The localized detail line.
 */
function setupDetailText(message: SetupDetailMessage, t: TFunction): string {
	const params = message.params ?? {};

	switch (message.code) {
		case 'claude-executable-not-found':
			return t(
				'common:setup-check.detail.claude-executable-not-found',
				'{{provider}} was not found in the shell-derived PATH. Ensemblr does not ship it: install {{provider}}, then retry.',
				{ provider: CLAUDE.label },
			);
		case 'claude-executable-on-path':
			return t(
				'common:setup-check.detail.claude-executable-on-path',
				'Found on PATH: {{path}}.',
				params,
			);
		case 'claude-executable-override':
			return t(
				'common:setup-check.detail.claude-executable-override',
				'Configured override: {{path}}.',
				params,
			);
		case 'claude-executable-override-broken':
			return t(
				'common:setup-check.detail.claude-executable-override-broken',
				'The configured {{provider}} executable could not be run. Clear the override to fall back to the {{command}} on your PATH, or pick a runnable binary.',
				{ command: CLAUDE.executableCommand, provider: CLAUDE.label },
			);
		case 'claude-unknown-error':
			return t(
				'common:setup-check.detail.claude-unknown-error',
				'Unknown {{provider}} executable check error.',
				{ provider: CLAUDE.label },
			);
		case 'config-loaded':
			return t(
				'common:setup-check.detail.config-loaded',
				'Declarative config loaded.',
			);
		case 'config-missing':
			return t(
				'common:setup-check.detail.config-missing',
				'No declarative config file was found; built-in defaults are active.',
			);
		case 'database-open-failed':
			return t(
				'common:setup-check.detail.database-open-failed',
				'SQLite failed to open at {{path}}.',
				params,
			);
		case 'database-ready':
			return t(
				'common:setup-check.detail.database-ready',
				'SQLite opened at {{path}}; schema version {{schemaVersion}}.',
				params,
			);
		case 'environment-cataloged':
			return t(
				'common:setup-check.detail.environment-cataloged',
				'{{configured}} configured variables, {{masked}} masked secrets, and {{reserved}} reserved runtime variables are cataloged.',
				params,
			);
		case 'environment-missing-required':
			return t('common:setup-check.detail.environment-missing-required', {
				count: Number(params.count ?? 0),
				defaultValue_one: '{{count}} required environment variable is unset.',
				defaultValue_other:
					'{{count}} required environment variables are unset.',
			});
		case 'environment-unknown-error':
			return t(
				'common:setup-check.detail.environment-unknown-error',
				'Unknown environment variable check error.',
			);
		case 'gh-auth-cli-not-found':
			return t(
				'common:setup-check.detail.gh-auth-cli-not-found',
				'GitHub CLI was not found before authentication could be checked. Install gh, then retry.',
			);
		case 'gh-auth-output-truncated':
			return t(
				'common:setup-check.detail.gh-auth-output-truncated',
				'GitHub authentication check produced too much output.',
			);
		case 'gh-auth-ready':
			return t(
				'common:setup-check.detail.gh-auth-ready',
				'GitHub CLI is authenticated for {{hostname}}.',
				params,
			);
		case 'gh-auth-required':
			return t(
				'common:setup-check.detail.gh-auth-required',
				'GitHub CLI is not authenticated for {{hostname}}. Run gh auth login --hostname {{hostname}}, then retry.',
				params,
			);
		case 'gh-auth-timeout':
			return t(
				'common:setup-check.detail.gh-auth-timeout',
				'GitHub authentication check timed out for {{hostname}}.',
				params,
			);
		case 'gh-auth-unknown-error':
			return t(
				'common:setup-check.detail.gh-auth-unknown-error',
				'Unknown GitHub auth check error.',
			);
		case 'gh-cli-available':
			return t(
				'common:setup-check.detail.gh-cli-available',
				'GitHub CLI is available: {{version}}.',
				params,
			);
		case 'gh-cli-available-unknown-version':
			return t(
				'common:setup-check.detail.gh-cli-available-unknown-version',
				'GitHub CLI is available.',
			);
		case 'gh-cli-failed':
			return t(
				'common:setup-check.detail.gh-cli-failed',
				'GitHub CLI version check failed: {{message}}',
				params,
			);
		case 'gh-cli-failed-unknown':
			return t(
				'common:setup-check.detail.gh-cli-failed-unknown',
				'GitHub CLI version check failed for an unknown reason.',
			);
		case 'gh-cli-not-found':
			return t(
				'common:setup-check.detail.gh-cli-not-found',
				'GitHub CLI was not found in the shell-derived PATH. Install gh, then retry.',
			);
		case 'gh-cli-output-truncated':
			return t(
				'common:setup-check.detail.gh-cli-output-truncated',
				'GitHub CLI version check produced too much output.',
			);
		case 'gh-cli-timeout':
			return t(
				'common:setup-check.detail.gh-cli-timeout',
				'GitHub CLI version check timed out.',
			);
		case 'gh-cli-unknown-error':
			return t(
				'common:setup-check.detail.gh-cli-unknown-error',
				'Unknown GitHub CLI check error.',
			);
		case 'git-available':
			return t(
				'common:setup-check.detail.git-available',
				'Git is available: {{version}}.',
				params,
			);
		case 'git-available-unknown-version':
			return t(
				'common:setup-check.detail.git-available-unknown-version',
				'Git is available.',
			);
		case 'git-failed':
			return t(
				'common:setup-check.detail.git-failed',
				'Git version check failed: {{message}}',
				params,
			);
		case 'git-failed-unknown':
			return t(
				'common:setup-check.detail.git-failed-unknown',
				'Git version check failed for an unknown reason.',
			);
		case 'git-not-found':
			return t(
				'common:setup-check.detail.git-not-found',
				'Git was not found in the shell-derived PATH. Install Git or Xcode Command Line Tools, then retry.',
			);
		case 'git-output-truncated':
			return t(
				'common:setup-check.detail.git-output-truncated',
				'Git version check produced too much output.',
			);
		case 'git-timeout':
			return t(
				'common:setup-check.detail.git-timeout',
				'Git version check timed out.',
			);
		case 'git-unknown-error':
			return t(
				'common:setup-check.detail.git-unknown-error',
				'Unknown git check error.',
			);
		case 'linear-connected':
			return t(
				'common:setup-check.detail.linear-connected',
				'Linear is connected.',
			);
		case 'linear-connected-as':
			return t(
				'common:setup-check.detail.linear-connected-as',
				'Linear is connected as {{identity}}.',
				params,
			);
		case 'linear-connected-with-organization':
			return t(
				'common:setup-check.detail.linear-connected-with-organization',
				'Linear is connected as {{identity}} ({{organization}}).',
				params,
			);
		case 'linear-not-configured':
			return t(
				'common:setup-check.detail.linear-not-configured',
				'Linear OAuth is not configured. Add app.linear.clientId to the Ensemblr config to enable Linear workflows. Linear is optional for local and GitHub-only workflows.',
			);
		case 'linear-not-connected':
			return t(
				'common:setup-check.detail.linear-not-connected',
				'Linear is not connected. Sign in from integration settings to enable Linear workflows.',
			);
		case 'linear-reconnect-required':
			return t(
				'common:setup-check.detail.linear-reconnect-required',
				'The stored Linear token expired and cannot be refreshed. Reconnect Linear from integration settings.',
			);
		case 'linear-unknown-error':
			return t(
				'common:setup-check.detail.linear-unknown-error',
				'Unknown Linear check error.',
			);
		case 'managed-directories-attention':
			return t(
				'common:setup-check.detail.managed-directories-attention',
				'Managed directories need attention: {{keys}}.',
				params,
			);
		case 'managed-directories-ready':
			return t(
				'common:setup-check.detail.managed-directories-ready',
				'Managed repos, workspaces, and archived-contexts directories are ready.',
			);
		case 'pi-agent-directory-ready':
			return t(
				'common:setup-check.detail.pi-agent-directory-ready',
				'Pi agent directory resolves from {{source}}: {{path}}.',
				params,
			);
		case 'pi-agent-directory-unknown-error':
			return t(
				'common:setup-check.detail.pi-agent-directory-unknown-error',
				'Unknown Pi agent directory check error.',
			);
		case 'pi-agent-directory-unverified':
			return t(
				'common:setup-check.detail.pi-agent-directory-unverified',
				'Pi agent directory could not be verified. Fix the Pi environment path or directory permissions, then retry.',
			);
		case 'pi-executable-not-found':
			return t(
				'common:setup-check.detail.pi-executable-not-found',
				'Pi executable could not be discovered. Install Pi, select a compatible executable or wrapper, then retry.',
			);
		case 'pi-executable-probe-warning':
			return t(
				'common:setup-check.detail.pi-executable-probe-warning',
				'Pi executable is present at {{path}}, but version/help probing needs attention.',
				params,
			);
		case 'pi-executable-ready-no-probe':
			return t(
				'common:setup-check.detail.pi-executable-ready-no-probe',
				'Pi executable selected from {{source}}: {{path}}. No version/help probe ran.',
				{
					path: params.path,
					source: piExecutableSourceLabel(params.source, t),
				},
			);
		case 'pi-executable-ready-with-probe':
			return t(
				'common:setup-check.detail.pi-executable-ready-with-probe',
				'Pi executable selected from {{source}}: {{path}}. {{probeKind}} probe returned: {{probeDetail}}',
				{
					path: params.path,
					probeDetail: params.probeDetail,
					probeKind: params.probeKind,
					source: piExecutableSourceLabel(params.source, t),
				},
			);
		case 'pi-executable-unknown-error':
			return t(
				'common:setup-check.detail.pi-executable-unknown-error',
				'Unknown Pi executable check error.',
			);
		case 'pi-models-ready':
			return t(
				'common:setup-check.detail.pi-models-ready',
				'Pi listed {{modelCount}} models across {{providerCount}} providers.',
				params,
			);
		case 'pi-models-unknown-error':
			return t(
				'common:setup-check.detail.pi-models-unknown-error',
				'Unknown Pi provider/model check error.',
			);
		case 'pi-models-unverified':
			return t(
				'common:setup-check.detail.pi-models-unverified',
				'Pi provider/model readiness could not be verified.',
			);
		case 'pi-rpc-invalid':
			return t(
				'common:setup-check.detail.pi-rpc-invalid',
				'Pi RPC startup did not produce valid JSONL.',
			);
		case 'pi-rpc-ready':
			return t(
				'common:setup-check.detail.pi-rpc-ready',
				'Pi RPC startup produced a valid {{frameType}} frame from {{cwd}}.',
				params,
			);
		case 'pi-rpc-unknown-error':
			return t(
				'common:setup-check.detail.pi-rpc-unknown-error',
				'Unknown Pi RPC check error.',
			);
		case 'root-directory-ready':
			return t(
				'common:setup-check.detail.root-directory-ready',
				'Ensemblr root is ready at {{path}}.',
				params,
			);
		case 'shell-fallback-environment':
			return t(
				'common:setup-check.detail.shell-fallback-environment',
				'Commands launch successfully, but shell environment resolution used a fallback.',
			);
		case 'shell-ready':
			return t(
				'common:setup-check.detail.shell-ready',
				'Commands launch successfully with the shell-derived environment.',
			);
		case 'shell-smoke-failed':
			return t(
				'common:setup-check.detail.shell-smoke-failed',
				'The process launch smoke check failed.',
			);
		case 'shell-unknown-error':
			return t(
				'common:setup-check.detail.shell-unknown-error',
				'Unknown process error.',
			);
		case 'unknown-check-error':
			return t(
				'common:setup-check.detail.unknown-check-error',
				'Unknown check error.',
			);
	}
}

/**
 * Names where a Pi executable was resolved from. The checks send the raw source
 * so the label reads in the app language rather than arriving pre-worded.
 * @param source - Raw resolution source the check reported.
 * @param t - Translator from the calling component.
 * @returns The source label.
 */
export function piExecutableSourceLabel(
	source: number | string | undefined,
	t: TFunction,
): string {
	switch (source) {
		case 'built-in-default':
			return t(
				'common:setup-check.pi-source.built-in-default',
				'built-in default',
			);
		case 'common-location':
			return t(
				'common:setup-check.pi-source.common-location',
				'common local binary location',
			);
		case 'config-default':
			return t(
				'common:setup-check.pi-source.config-default',
				'declarative config',
			);
		case 'ensemblr-config':
			return t(
				'common:setup-check.pi-source.ensemblr-config',
				'Ensemblr repository config',
			);
		case 'managed-config':
			return t('common:setup-check.pi-source.managed-config', 'managed config');
		case 'path':
			return t('common:setup-check.pi-source.path', 'shell PATH');
		case 'sqlite':
			return t('common:setup-check.pi-source.sqlite', 'user override');
		default:
			return t('common:setup-check.pi-source.unknown', 'unknown source');
	}
}
