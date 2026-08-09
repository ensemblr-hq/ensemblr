import type { TFunction } from 'i18next';

import type {
	SetupLogLabelCode,
	SetupMessageParams,
} from '@/shared/ipc/contracts/setup';

/**
 * Log label per authored code. Stream names (`stdout`, `stderr`, `cwd`) and
 * upstream diagnostic codes arrive without a code and never reach this table.
 */
export const SETUP_LOG_LABEL_TEXT: Record<
	SetupLogLabelCode,
	(t: TFunction, params: SetupMessageParams) => string
> = {
	'agent-directory-path': (t) =>
		t('common:setup-check.log.agent-directory-path', 'Agent directory path'),
	'catalog-entries': (t) =>
		t('common:setup-check.log.catalog-entries', 'Catalog entries'),
	command: (t) => t('common:setup-check.log.command', 'Command'),
	'config-diagnostic': (t) =>
		t('common:setup-check.log.config-diagnostic', 'Config diagnostic'),
	'configured-variables': (t) =>
		t('common:setup-check.log.configured-variables', 'Configured variables'),
	'database-error': (t) =>
		t('common:setup-check.log.database-error', 'Database error'),
	'database-path': (t) =>
		t('common:setup-check.log.database-path', 'Database path'),
	'executable-path': (t) =>
		t('common:setup-check.log.executable-path', 'Executable path'),
	'first-jsonl-frame': (t) =>
		t('common:setup-check.log.first-jsonl-frame', 'First JSONL frame'),
	'masked-secrets': (t) =>
		t('common:setup-check.log.masked-secrets', 'Masked secrets'),
	'model-count': (t) => t('common:setup-check.log.model-count', 'Model count'),
	'pi-probe': (t, params) =>
		t('common:setup-check.log.pi-probe', '{{kind}} probe', params),
	'provider-count': (t) =>
		t('common:setup-check.log.provider-count', 'Provider count'),
	'reserved-runtime-variables': (t) =>
		t(
			'common:setup-check.log.reserved-runtime-variables',
			'Reserved runtime variables',
		),
	'root-path': (t) => t('common:setup-check.log.root-path', 'Root path'),
	source: (t) => t('common:setup-check.log.source', 'Source'),
};
