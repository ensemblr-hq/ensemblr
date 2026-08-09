import type { TFunction } from 'i18next';

import { getAgentProviderDescriptor } from '@/shared/agent-provider';
import type { SetupCheckId } from '@/shared/ipc/contracts/setup';

const CLAUDE = getAgentProviderDescriptor('claude');

/**
 * Title per check id. A `Record` over the union rather than a `switch` so a new
 * check id is a missing-key compile error, and so the lookup costs one property
 * read instead of a branch per entry.
 */
export const SETUP_CHECK_TITLE: Record<SetupCheckId, (t: TFunction) => string> =
	{
		'claude-executable': (t) =>
			t(
				'common:setup-check.title.claude-executable',
				'{{provider}} executable',
				{
					provider: CLAUDE.label,
				},
			),
		config: (t) => t('common:setup-check.title.config', 'Declarative config'),
		'environment-variables': (t) =>
			t(
				'common:setup-check.title.environment-variables',
				'Environment variables',
			),
		'gh-auth': (t) =>
			t('common:setup-check.title.gh-auth', 'GitHub CLI authenticated'),
		'gh-cli': (t) =>
			t('common:setup-check.title.gh-cli', 'GitHub CLI installed'),
		'git-executable': (t) =>
			t('common:setup-check.title.git-executable', 'Git executable'),
		'linear-oauth': (t) =>
			t('common:setup-check.title.linear-oauth', 'Linear connection'),
		'managed-directories': (t) =>
			t('common:setup-check.title.managed-directories', 'Managed directories'),
		'pi-agent-directory': (t) =>
			t('common:setup-check.title.pi-agent-directory', 'Pi agent directory'),
		'pi-executable': (t) =>
			t('common:setup-check.title.pi-executable', 'Pi executable'),
		'pi-provider-model': (t) =>
			t(
				'common:setup-check.title.pi-provider-model',
				'Pi provider and model readiness',
			),
		'pi-rpc': (t) => t('common:setup-check.title.pi-rpc', 'Pi RPC startup'),
		'root-directory': (t) =>
			t('common:setup-check.title.root-directory', 'Root directory'),
		'shell-process-launch': (t) =>
			t(
				'common:setup-check.title.shell-process-launch',
				'Shell and process launch',
			),
		'sqlite-database': (t) =>
			t('common:setup-check.title.sqlite-database', 'SQLite database'),
	};
