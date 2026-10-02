import type {
	EnvironmentFilesResult,
	EnvironmentVariableCatalogEntrySnapshot,
	EnvironmentVariablesSnapshot,
} from '@/shared/ipc/contracts/environment';

import { DEMO_CLOCK, WORKSPACE_PATHS } from './workspaces.ts';

/** Secret variable catalog entry reused by the app and repository rows. */
const SECRET_CATALOG: EnvironmentVariableCatalogEntrySnapshot = {
	category: 'provider',
	description: 'API credential resolved without exposing its value.',
	key: 'API_TOKEN',
	required: false,
	reserved: false,
	scope: 'app',
	title: 'API token',
	valueKind: 'secret',
};

/** Repository-scoped secret shown beside the global credential. */
const DEPLOY_CATALOG: EnvironmentVariableCatalogEntrySnapshot = {
	...SECRET_CATALOG,
	key: 'DEPLOY_TOKEN',
	scope: 'repository',
	title: 'Deploy token',
};

/** Masked global and repository environment rows for settings screenshots. */
export const DEMO_ENVIRONMENT_VARIABLES: EnvironmentVariablesSnapshot = {
	catalog: [SECRET_CATALOG, DEPLOY_CATALOG],
	diagnostics: [],
	generatedAt: DEMO_CLOCK,
	missingRequiredCount: 0,
	requiredCount: 0,
	variables: [
		{
			catalog: SECRET_CATALOG,
			characterCount: 32,
			key: 'API_TOKEN',
			maskedDisplay: '••••••••••••',
			required: false,
			scope: 'app',
			scopeId: '',
			source: 'secret-metadata',
			status: 'masked',
			valueKind: 'secret',
		},
		{
			catalog: DEPLOY_CATALOG,
			characterCount: 40,
			key: 'DEPLOY_TOKEN',
			maskedDisplay: '••••••••••••',
			required: false,
			scope: 'repository',
			scopeId: 'repo-ensemblr',
			source: 'secret-metadata',
			status: 'masked',
			valueKind: 'secret',
		},
	],
};

/** Env-file rows returned by the settings surface. */
export const DEMO_ENV_FILES: EnvironmentFilesResult = {
	paths: [
		'~/.config/ensemblr/global.env',
		`${WORKSPACE_PATHS.releaseNotes}/.env.local`,
	],
};
