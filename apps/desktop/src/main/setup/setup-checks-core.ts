import type { EnvironmentVariablesSnapshot } from '../../shared/ipc/contracts/environment';
import type { SetupCheckLogSnapshot } from '../../shared/ipc/contracts/setup';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsemblrConfigService } from '../config';
import type { EnvironmentVariablesService } from '../environment';
import type { EnsemblrRootDirectoryService } from '../root';
import type { SafeStorageStatus } from '../secrets/index.ts';
import type { EnsemblrDatabaseService } from '../storage';
import {
	appendCommandStreamLogs,
	authoredDetail,
	defineCheck,
	type SetupCheckProviderContext,
	unexpectedErrorDetail,
} from './setup-check-context.ts';

/** Returns the safe display of `text` with the user's home collapsed to `~`. */
type SafeTextFormatter = (text: string, homeDirectory: string) => string;

/** Builds the snapshot for the declarative-config setup check. */
export function getConfigCheck({
	configService,
	context,
}: {
	configService: EnsemblrConfigService;
	context: SetupCheckProviderContext;
}) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: true,
		description:
			'Loads ~/.config/ensemblr/config.json and validates whether config can be trusted before setup continues.',
		group: 'core',
		id: 'config',
		run: () => {
			const config = configService.getSnapshot();
			const diagnostics = config.diagnostics.map(
				(diagnostic) => `${diagnostic.code}: ${diagnostic.message}`,
			);
			const status = config.blocksReadiness
				? 'failure'
				: config.status === 'ok' || config.status === 'missing'
					? 'success'
					: 'warning';
			const upstreamDetail = diagnostics[0];

			return {
				...(upstreamDetail
					? { detail: upstreamDetail }
					: config.status === 'missing'
						? authoredDetail(
								'config-missing',
								'No declarative config file was found; built-in defaults are active.',
							)
						: authoredDetail('config-loaded', 'Declarative config loaded.')),
				logs: diagnostics.map((diagnostic) => ({
					label: 'Config diagnostic',
					labelMessage: { code: 'config-diagnostic' as const },
					text: diagnostic,
				})),
				remediationActions: [
					{
						id: 'open-config-settings',
						kind: 'open-settings',
						label: 'Open config diagnostics',
						target: 'config',
					},
					{
						id: 'retry-config',
						kind: 'retry',
						label: 'Retry config check',
					},
				],
				status,
			};
		},
		title: 'Declarative config',
	});

	return check(context);
}

/** Builds the snapshot for the environment-variables setup check. */
export function getEnvironmentVariablesCheck({
	context,
	environmentVariablesService,
}: {
	context: SetupCheckProviderContext;
	environmentVariablesService: EnvironmentVariablesService;
}) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: true,
		description:
			'Checks the global environment variable catalog and safe secret metadata without printing values.',
		group: 'core',
		id: 'environment-variables',
		onError: (error) => ({
			blocking: false,
			...unexpectedErrorDetail(error, {
				code: 'environment-unknown-error',
				text: 'Unknown environment variable check error.',
			}),
			status: 'warning',
		}),
		run: async () => {
			const snapshot = await environmentVariablesService.getSnapshot();
			const errorCount = snapshot.diagnostics.filter(
				(diagnostic) => diagnostic.severity === 'error',
			).length;
			const warningCount = snapshot.diagnostics.filter(
				(diagnostic) => diagnostic.severity === 'warning',
			).length;
			const blocking = snapshot.requiredCount > 0;
			const status =
				snapshot.missingRequiredCount > 0
					? 'failure'
					: errorCount > 0 || warningCount > 0
						? 'warning'
						: 'success';

			return {
				blocking,
				...getEnvironmentVariablesDetail(snapshot),
				logs: createEnvironmentVariablesLogs(snapshot),
				remediationActions: [
					{
						id: 'open-environment-settings',
						kind: 'open-settings',
						label: 'Open environment settings',
						target: 'environment',
					},
					{
						id: 'retry-environment-variables',
						kind: 'retry',
						label: 'Retry environment check',
					},
				],
				status,
			};
		},
		title: 'Environment variables',
	});

	return check(context);
}

/** Builds the snapshot for the SQLite database setup check. */
export function getDatabaseCheck({
	context,
	databaseService,
	formatSafeText,
}: {
	context: SetupCheckProviderContext;
	databaseService: EnsemblrDatabaseService;
	formatSafeText: SafeTextFormatter;
}) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: true,
		description:
			'Opens the local app-support SQLite database and verifies migrations completed.',
		group: 'storage',
		id: 'sqlite-database',
		run: (ctx) => {
			const database = databaseService.getHealth();
			const status = database.status === 'ok' ? 'success' : 'failure';
			const safePath = formatSafeText(database.path, ctx.homeDirectory);

			return {
				...(database.status === 'ok'
					? authoredDetail(
							'database-ready',
							`SQLite opened at ${safePath}; schema version ${database.schemaVersion}.`,
							{ path: safePath, schemaVersion: database.schemaVersion },
						)
					: database.error
						? { detail: database.error }
						: authoredDetail(
								'database-open-failed',
								`SQLite failed to open at ${safePath}.`,
								{ path: safePath },
							)),
				logs: [
					{
						label: 'Database path',
						labelMessage: { code: 'database-path' as const },
						text: safePath,
					},
					...(database.error
						? [
								{
									label: 'Database error',
									labelMessage: { code: 'database-error' as const },
									text: database.error,
								},
							]
						: []),
				],
				remediationActions: [
					{
						id: 'retry-database',
						kind: 'retry',
						label: 'Retry database check',
					},
				],
				status,
			};
		},
		title: 'SQLite database',
	});

	return check(context);
}

/** Builds the snapshot for the Ensemblr root-directory setup check. */
export function getRootDirectoryCheck({
	context,
	formatSafeText,
	rootDirectoryService,
}: {
	context: SetupCheckProviderContext;
	formatSafeText: SafeTextFormatter;
	rootDirectoryService: EnsemblrRootDirectoryService;
}) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: true,
		description:
			'Validates the configured Ensemblr root directory before repositories and workspaces are created.',
		group: 'storage',
		id: 'root-directory',
		run: (ctx) => {
			const root =
				rootDirectoryService.getSnapshot() ?? rootDirectoryService.ensure();
			const status =
				root.status === 'ok'
					? 'success'
					: root.status === 'warning'
						? 'warning'
						: 'failure';
			const safePath = formatSafeText(root.path, ctx.homeDirectory);
			const upstreamDetail = root.diagnostics[0]?.message;

			return {
				...(upstreamDetail
					? { detail: upstreamDetail }
					: authoredDetail(
							'root-directory-ready',
							`Ensemblr root is ready at ${safePath}.`,
							{ path: safePath },
						)),
				logs: [
					{
						label: 'Root path',
						labelMessage: { code: 'root-path' as const },
						text: safePath,
					},
					...root.diagnostics.map((diagnostic) => ({
						label: diagnostic.code,
						text: diagnostic.path
							? `${diagnostic.message} ${formatSafeText(
									diagnostic.path,
									ctx.homeDirectory,
								)}`
							: diagnostic.message,
					})),
				],
				remediationActions: [
					{
						id: 'choose-root-directory',
						kind: 'select-path',
						label: 'Choose another root',
						target: 'rootDirectory',
					},
					{
						id: 'retry-root-directory',
						kind: 'retry',
						label: 'Retry root check',
					},
				],
				status,
			};
		},
		title: 'Root directory',
	});

	return check(context);
}

/** Builds the snapshot for the managed-directories setup check. */
export function getManagedDirectoriesCheck({
	context,
	formatSafeText,
	rootDirectoryService,
}: {
	context: SetupCheckProviderContext;
	formatSafeText: SafeTextFormatter;
	rootDirectoryService: EnsemblrRootDirectoryService;
}) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: true,
		description:
			'Checks repos, workspaces, and archived-contexts under the selected root.',
		group: 'storage',
		id: 'managed-directories',
		run: (ctx) => {
			const root =
				rootDirectoryService.getSnapshot() ?? rootDirectoryService.ensure();
			const failingPaths = root.managedPaths.filter(
				(managedPath) =>
					managedPath.status === 'invalid' || managedPath.status === 'missing',
			);
			const status = failingPaths.length > 0 ? 'failure' : 'success';
			const failingKeys = failingPaths
				.map((managedPath) => managedPath.key)
				.join(', ');

			return {
				...(failingPaths.length > 0
					? authoredDetail(
							'managed-directories-attention',
							`Managed directories need attention: ${failingKeys}.`,
							{ keys: failingKeys },
						)
					: authoredDetail(
							'managed-directories-ready',
							'Managed repos, workspaces, and archived-contexts directories are ready.',
						)),
				logs: root.managedPaths.map((managedPath) => ({
					label: managedPath.key,
					text: `${managedPath.status}: ${formatSafeText(
						managedPath.path,
						ctx.homeDirectory,
					)}`,
				})),
				remediationActions: [
					{
						id: 'retry-managed-directories',
						kind: 'retry',
						label: 'Retry directory check',
					},
				],
				status,
			};
		},
		title: 'Managed directories',
	});

	return check(context);
}

/** Builds the snapshot for the shell-process-launch setup check. */
export function getShellProcessCheck({
	context,
	localCommandService,
}: {
	context: SetupCheckProviderContext;
	localCommandService: LocalCommandService;
}) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: true,
		description:
			'Verifies Electron can launch local commands through the user shell environment.',
		group: 'core',
		id: 'shell-process-launch',
		onError: (error) =>
			unexpectedErrorDetail(error, {
				code: 'shell-unknown-error',
				text: 'Unknown process error.',
			}),
		run: async () => {
			const environment = await localCommandService.getEnvironment();
			const result = await localCommandService.run({
				args: ['-lc', 'printf ensemblr-process-ok'],
				command: environment.shell,
				maxOutputBytes: 1024,
				timeoutMs: 1500,
			});
			const logs: SetupCheckLogSnapshot[] = environment.diagnostics.map(
				(diagnostic) => ({
					label: diagnostic.code,
					text: diagnostic.message,
				}),
			);

			appendCommandStreamLogs(logs, result);

			if (result.status !== 'success') {
				return {
					...(result.failure?.message
						? { detail: result.failure.message }
						: authoredDetail(
								'shell-smoke-failed',
								'The process launch smoke check failed.',
							)),
					logs,
					status: 'failure',
				};
			}

			const status =
				environment.source === 'fallback' || environment.diagnostics.length > 0
					? 'warning'
					: 'success';

			return {
				...(status === 'success'
					? authoredDetail(
							'shell-ready',
							'Commands launch successfully with the shell-derived environment.',
						)
					: authoredDetail(
							'shell-fallback-environment',
							'Commands launch successfully, but shell environment resolution used a fallback.',
						)),
				logs,
				status,
			};
		},
		title: 'Shell and process launch',
	});

	return check(context);
}

/**
 * Builds the snapshot for the OS-keyring check that backs the Linux secret
 * store. It never fails the setup: a session with no keyring daemon still runs,
 * it just stores secrets obfuscated rather than encrypted, and the user needs
 * to be told rather than blocked.
 */
export function getSecretStorageCheck({
	context,
	readStatus,
}: {
	context: SetupCheckProviderContext;
	readStatus: () => SafeStorageStatus;
}) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: false,
		description:
			'Reports which OS keyring backend encrypts stored secrets, and warns when the session offers none.',
		group: 'core',
		id: 'secret-storage',
		onError: (error) => ({
			...unexpectedErrorDetail(error, {
				code: 'secret-storage-unknown-error',
				text: 'Unknown secret storage check error.',
			}),
			status: 'warning',
		}),
		run: () => {
			const status = readStatus();
			const logs: SetupCheckLogSnapshot[] = [
				{
					label: 'Keyring backend',
					labelMessage: { code: 'keyring-backend' as const },
					text: status.backend,
				},
			];

			if (status.protection === 'unavailable') {
				return {
					...authoredDetail(
						'secret-storage-unavailable',
						'No OS keyring is available, so secrets cannot be saved. Start a keyring daemon (gnome-keyring or KWallet) and retry.',
					),
					logs,
					remediationActions: [
						{
							id: 'retry-secret-storage',
							kind: 'retry',
							label: 'Retry secret storage check',
						},
					],
					status: 'warning',
				};
			}

			if (status.protection === 'obfuscated') {
				return {
					...authoredDetail(
						'secret-storage-plaintext',
						'No keyring daemon answered, so stored secrets are only obfuscated rather than encrypted. Start gnome-keyring or KWallet and restart Ensemblr.',
					),
					logs,
					remediationActions: [
						{
							id: 'retry-secret-storage',
							kind: 'retry',
							label: 'Retry secret storage check',
						},
					],
					status: 'warning',
				};
			}

			return {
				...authoredDetail(
					'secret-storage-encrypted',
					'Secrets are encrypted by the {{backend}} keyring.',
					{ backend: status.backend },
				),
				logs,
				status: 'success',
			};
		},
		title: 'Secret storage',
	});

	return check(context);
}

/** Per-status counts derived from an env-vars snapshot. */
interface EnvironmentVariableStatusCounts {
	configured: number;
	masked: number;
	reserved: number;
}

/** Counts how many variables fall into each status bucket. */
function countEnvironmentVariableStatuses(
	snapshot: EnvironmentVariablesSnapshot,
): EnvironmentVariableStatusCounts {
	let configured = 0;
	let masked = 0;
	let reserved = 0;
	for (const variable of snapshot.variables) {
		if (variable.status === 'set' || variable.status === 'masked') {
			configured += 1;
		}
		if (variable.status === 'masked') {
			masked += 1;
		}
		if (variable.status === 'reserved') {
			reserved += 1;
		}
	}
	return { configured, masked, reserved };
}

/** Renders the headline detail for the env-vars check. */
function getEnvironmentVariablesDetail(snapshot: EnvironmentVariablesSnapshot) {
	if (snapshot.missingRequiredCount > 0) {
		return authoredDetail(
			'environment-missing-required',
			`${snapshot.missingRequiredCount} required environment variables are unset.`,
			{ count: snapshot.missingRequiredCount },
		);
	}

	const { configured, masked, reserved } =
		countEnvironmentVariableStatuses(snapshot);

	return authoredDetail(
		'environment-cataloged',
		`${configured} configured variables, ${masked} masked secrets, and ${reserved} reserved runtime variables are cataloged.`,
		{ configured, masked, reserved },
	);
}

/** Renders the per-variable counts and diagnostics as setup check logs. */
function createEnvironmentVariablesLogs(
	snapshot: EnvironmentVariablesSnapshot,
): SetupCheckLogSnapshot[] {
	const { configured, masked, reserved } =
		countEnvironmentVariableStatuses(snapshot);

	return [
		{
			label: 'Catalog entries',
			labelMessage: { code: 'catalog-entries' },
			text: String(snapshot.catalog.length),
		},
		{
			label: 'Configured variables',
			labelMessage: { code: 'configured-variables' },
			text: String(configured),
		},
		{
			label: 'Masked secrets',
			labelMessage: { code: 'masked-secrets' },
			text: String(masked),
		},
		{
			label: 'Reserved runtime variables',
			labelMessage: { code: 'reserved-runtime-variables' },
			text: String(reserved),
		},
		...snapshot.diagnostics.map((diagnostic) => ({
			label: diagnostic.code,
			text: diagnostic.key
				? `${diagnostic.key}: ${diagnostic.message}`
				: diagnostic.message,
		})),
	];
}
