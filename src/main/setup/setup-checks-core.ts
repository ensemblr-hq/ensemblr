import type {
	EnvironmentVariablesSnapshot,
	SetupCheckLogSnapshot,
} from '../../shared/ipc';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsembleConfigService } from '../config/config-loader';
import type { EnvironmentVariablesService } from '../environment/environment-variables';
import type { EnsembleRootDirectoryService } from '../root/root-directory-service';
import type { EnsembleDatabaseService } from '../storage/database';
import {
	appendCommandStreamLogs,
	defineCheck,
	type SetupCheckProviderContext,
} from './setup-check-context.ts';

/** Returns the safe display of `text` with the user's home collapsed to `~`. */
type SafeTextFormatter = (text: string, homeDirectory: string) => string;

/** Builds the snapshot for the declarative-config setup check. */
export function getConfigCheck({
	configService,
	context,
}: {
	configService: EnsembleConfigService;
	context: SetupCheckProviderContext;
}) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: true,
		description:
			'Loads ~/.config/ensemble/config.json and validates whether config can be trusted before setup continues.',
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
			const detail =
				diagnostics[0] ??
				(config.status === 'missing'
					? 'No declarative config file was found; built-in defaults are active.'
					: 'Declarative config loaded.');

			return {
				detail,
				logs: diagnostics.map((diagnostic) => ({
					label: 'Config diagnostic',
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
			detail:
				error instanceof Error
					? error.message
					: 'Unknown environment variable check error.',
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
				detail: getEnvironmentVariablesDetail(snapshot),
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
	databaseService: EnsembleDatabaseService;
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
			const detail =
				database.status === 'ok'
					? `SQLite opened at ${safePath}; schema version ${database.schemaVersion}.`
					: (database.error ?? `SQLite failed to open at ${safePath}.`);

			return {
				detail,
				logs: [
					{
						label: 'Database path',
						text: safePath,
					},
					...(database.error
						? [
								{
									label: 'Database error',
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

/** Builds the snapshot for the Ensemble root-directory setup check. */
export function getRootDirectoryCheck({
	context,
	formatSafeText,
	rootDirectoryService,
}: {
	context: SetupCheckProviderContext;
	formatSafeText: SafeTextFormatter;
	rootDirectoryService: EnsembleRootDirectoryService;
}) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: true,
		description:
			'Validates the configured Ensemble root directory before repositories and workspaces are created.',
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
			const detail =
				root.diagnostics[0]?.message ??
				`Ensemble root is ready at ${safePath}.`;

			return {
				detail,
				logs: [
					{
						label: 'Root path',
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
	rootDirectoryService: EnsembleRootDirectoryService;
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
			const detail =
				failingPaths.length > 0
					? `Managed directories need attention: ${failingPaths
							.map((managedPath) => managedPath.key)
							.join(', ')}.`
					: 'Managed repos, workspaces, and archived-contexts directories are ready.';

			return {
				detail,
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
		onError: (error) => ({
			detail: error instanceof Error ? error.message : 'Unknown process error.',
		}),
		run: async () => {
			const environment = await localCommandService.getEnvironment();
			const result = await localCommandService.run({
				args: ['-lc', 'printf ensemble-process-ok'],
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
					detail:
						result.failure?.message ??
						'The process launch smoke check failed.',
					logs,
					status: 'failure',
				};
			}

			const status =
				environment.source === 'fallback' || environment.diagnostics.length > 0
					? 'warning'
					: 'success';
			const detail =
				status === 'success'
					? 'Commands launch successfully with the shell-derived environment.'
					: 'Commands launch successfully, but shell environment resolution used a fallback.';

			return {
				detail,
				logs,
				status,
			};
		},
		title: 'Shell and process launch',
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

/** Renders the headline detail string for the env-vars check. */
function getEnvironmentVariablesDetail(
	snapshot: EnvironmentVariablesSnapshot,
): string {
	if (snapshot.missingRequiredCount > 0) {
		return `${snapshot.missingRequiredCount} required environment variables are unset.`;
	}

	const { configured, masked, reserved } =
		countEnvironmentVariableStatuses(snapshot);

	return `${configured} configured variables, ${masked} masked secrets, and ${reserved} reserved runtime variables are cataloged.`;
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
			text: String(snapshot.catalog.length),
		},
		{
			label: 'Configured variables',
			text: String(configured),
		},
		{
			label: 'Masked secrets',
			text: String(masked),
		},
		{
			label: 'Reserved runtime variables',
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
