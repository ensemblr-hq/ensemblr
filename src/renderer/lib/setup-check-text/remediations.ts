import type { TFunction } from 'i18next';

import { getAgentProviderDescriptor } from '@/shared/agent-provider';

const CLAUDE = getAgentProviderDescriptor('claude');
const PI = getAgentProviderDescriptor('pi');

/**
 * Button label per remediation id. Keyed by plain string and not by a union,
 * because `SetupRemediationAction.id` is open — an id with no entry falls back
 * to the generic retry label or to the English the check authored.
 */
export const SETUP_REMEDIATION_LABEL: Record<string, (t: TFunction) => string> =
	{
		'choose-root-directory': (t) =>
			t(
				'common:setup-check.action.choose-root-directory',
				'Choose another root',
			),
		'install-claude-code': (t) =>
			t(
				'common:setup-check.action.install-claude-code',
				'Copy the {{provider}} install command',
				{ provider: CLAUDE.label },
			),
		'install-command-line-tools': (t) =>
			t(
				'common:setup-check.action.install-command-line-tools',
				'Install command-line tools',
			),
		'open-claude-setup-docs': (t) =>
			t(
				'common:setup-check.action.open-claude-setup-docs',
				'Open {{provider}} setup docs',
				{ provider: CLAUDE.label },
			),
		'open-config-settings': (t) =>
			t(
				'common:setup-check.action.open-config-settings',
				'Open config diagnostics',
			),
		'open-environment-settings': (t) =>
			t(
				'common:setup-check.action.open-environment-settings',
				'Open environment settings',
			),
		'open-gh-install': (t) =>
			t(
				'common:setup-check.action.open-gh-install',
				'Open GitHub CLI install docs',
			),
		'open-git-install': (t) =>
			t('common:setup-check.action.open-git-install', 'Open Git install docs'),
		'open-linear-settings': (t) =>
			t(
				'common:setup-check.action.open-linear-settings',
				'Open integration settings',
			),
		'open-pi-provider-settings': (t) =>
			t(
				'common:setup-check.action.open-pi-provider-settings',
				'Open Pi provider settings',
			),
		'retry-claude-executable': (t) =>
			t(
				'common:setup-check.action.retry-claude-executable',
				'Retry {{provider}} executable check',
				{ provider: CLAUDE.label },
			),
		'retry-claude-readiness': (t) =>
			t(
				'common:setup-check.action.rerun-provider-checks',
				'Re-run {{provider}} checks',
				{ provider: CLAUDE.label },
			),
		'retry-config': (t) =>
			t('common:setup-check.action.retry-config', 'Retry config check'),
		'retry-database': (t) =>
			t('common:setup-check.action.retry-database', 'Retry database check'),
		'retry-environment-variables': (t) =>
			t(
				'common:setup-check.action.retry-environment-variables',
				'Retry environment check',
			),
		'retry-gh-auth': (t) =>
			t('common:setup-check.action.retry-gh-auth', 'Retry GitHub auth check'),
		'retry-gh-cli': (t) =>
			t('common:setup-check.action.retry-gh-cli', 'Retry gh check'),
		'retry-git-executable': (t) =>
			t('common:setup-check.action.retry-git-executable', 'Retry git check'),
		'retry-linear': (t) =>
			t('common:setup-check.action.retry-linear', 'Retry Linear check'),
		'retry-managed-directories': (t) =>
			t(
				'common:setup-check.action.retry-managed-directories',
				'Retry directory check',
			),
		'retry-pi-agent-directory': (t) =>
			t(
				'common:setup-check.action.retry-pi-agent-directory',
				'Retry Pi agent directory check',
			),
		'retry-pi-executable': (t) =>
			t(
				'common:setup-check.action.retry-pi-executable',
				'Retry Pi executable check',
			),
		'retry-pi-provider-model': (t) =>
			t(
				'common:setup-check.action.retry-pi-provider-model',
				'Retry provider/model check',
			),
		'retry-pi-readiness': (t) =>
			t(
				'common:setup-check.action.rerun-provider-checks',
				'Re-run {{provider}} checks',
				{ provider: PI.label },
			),
		'retry-pi-rpc': (t) =>
			t('common:setup-check.action.retry-pi-rpc', 'Retry Pi RPC check'),
		'retry-root-directory': (t) =>
			t('common:setup-check.action.retry-root-directory', 'Retry root check'),
		'run-claude-login': (t) =>
			t('common:setup-check.action.run-claude-login', 'Run {{command}}', {
				command: CLAUDE.loginCommand ?? '',
			}),
		'run-gh-auth-login': (t) =>
			t('common:setup-check.action.run-gh-auth-login', 'Run gh auth login'),
		'select-claude-executable': (t) =>
			t(
				'common:setup-check.action.select-claude-executable',
				'Select {{provider}} executable',
				{ provider: CLAUDE.label },
			),
		'select-pi-executable': (t) =>
			t(
				'common:setup-check.action.select-pi-executable',
				'Select Pi executable',
			),
		'select-pi-executable-for-rpc': (t) =>
			t(
				'common:setup-check.action.select-pi-executable',
				'Select Pi executable',
			),
	};
