import { homedir } from 'node:os';

import type {
	EnvironmentVariablesSnapshot,
	SetupCheckId,
	SetupCheckLogSnapshot,
	SetupCheckSnapshot,
	SetupDiagnosticsSnapshot,
} from '../../shared/ipc';
import type {
	LocalCommandResult,
	LocalCommandService,
} from '../commands/local-command';
import type { EnsembleConfigService } from '../config/config-loader';
import type { EnvironmentVariablesService } from '../environment/environment-variables';
import type { PiExecutableService } from '../pi/pi-executable';
import type { PiReadinessService } from '../pi/pi-readiness';
import type { EnsembleRootDirectoryService } from '../root/root-directory';
import type { EnsembleDatabaseService } from '../storage/database';
import {
	getGitExecutableCheck,
	getGitHubAuthCheck,
	getGitHubCliCheck,
} from './setup-checks-github.ts';
import {
	getPiAgentDirectoryCheck,
	getPiExecutableCheck,
	getPiProviderModelCheck,
	getPiRpcCheck,
} from './setup-checks-pi.ts';

/** Public surface of the setup-diagnostics service. */
export interface SetupDiagnosticsService {
	getSnapshot: () => Promise<SetupDiagnosticsSnapshot>;
}

/** Shared context passed to every {@link SetupCheckProvider}. */
export interface SetupCheckProviderContext {
	homeDirectory: string;
	now: () => Date;
}

/** Function that produces one {@link SetupCheckSnapshot} for the diagnostics view. */
export type SetupCheckProvider = (
	context: SetupCheckProviderContext,
) => Promise<SetupCheckSnapshot> | SetupCheckSnapshot;

/** Options for {@link createSetupDiagnosticsService}. */
interface CreateSetupDiagnosticsServiceOptions {
	checkProviders?: Partial<Record<SetupCheckId, SetupCheckProvider>>;
	configService: EnsembleConfigService;
	databaseService: EnsembleDatabaseService;
	environmentVariablesService: EnvironmentVariablesService;
	homeDirectory?: string;
	localCommandService: LocalCommandService;
	now?: () => Date;
	piExecutableService: PiExecutableService;
	piReadinessService: PiReadinessService;
	rootDirectoryService: EnsembleRootDirectoryService;
}

const SETUP_CHECK_ORDER: readonly SetupCheckId[] = [
	'config',
	'sqlite-database',
	'root-directory',
	'managed-directories',
	'shell-process-launch',
	'environment-variables',
	'git-executable',
	'gh-cli',
	'gh-auth',
	'pi-executable',
	'pi-agent-directory',
	'pi-rpc',
	'pi-provider-model',
	'linear-oauth',
];

const SENSITIVE_ASSIGNMENT_PATTERN =
	/\b([A-Z0-9_.-]*(?:ACCESS[_-]?TOKEN|API[_-]?KEY|CREDENTIAL|PASSWORD|PRIVATE[_-]?KEY|SECRET|TOKEN)[A-Z0-9_.-]*)(\s*[=:]\s*)(["']?)([^\s"',;]+)/gi;
const GITHUB_TOKEN_PATTERN =
	/\b(?:gh[opsru]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g;
const TOKEN_LINE_PATTERN =
	/\b(Token:\s*)(?:gh[opsru]_|github_pat_)?[A-Za-z0-9_*]+/gi;

/**
 * Builds the diagnostics service that orchestrates every setup check, allowing
 * callers to override individual checks via `checkProviders` for tests.
 * @param options - Service dependencies and provider overrides.
 * @returns A {@link SetupDiagnosticsService}.
 */
export function createSetupDiagnosticsService({
	checkProviders = {},
	configService,
	databaseService,
	environmentVariablesService,
	homeDirectory = homedir(),
	localCommandService,
	now = () => new Date(),
	piExecutableService,
	piReadinessService,
	rootDirectoryService,
}: CreateSetupDiagnosticsServiceOptions): SetupDiagnosticsService {
	const context = { homeDirectory, now };
	const builtInProviders: Record<SetupCheckId, SetupCheckProvider> = {
		config: () => getConfigCheck({ configService, context }),
		'environment-variables': () =>
			getEnvironmentVariablesCheck({
				context,
				environmentVariablesService,
			}),
		'gh-auth': () => getGitHubAuthCheck({ context, localCommandService }),
		'gh-cli': () => getGitHubCliCheck({ context, localCommandService }),
		'git-executable': () =>
			getGitExecutableCheck({ context, localCommandService }),
		'linear-oauth': () =>
			createPendingCheck({
				blocking: false,
				detail:
					'Linear OAuth is optional for local and GitHub-only workflows. It will become required only when a Linear workflow is selected.',
				group: 'linear',
				id: 'linear-oauth',
				remediationActions: [
					{
						id: 'open-linear-settings',
						kind: 'open-settings',
						label: 'Open integration settings',
						target: 'linear',
					},
					{
						id: 'retry-linear',
						kind: 'retry',
						label: 'Retry Linear check',
					},
				],
				title: 'Linear connection',
				updatedAt: now().toISOString(),
			}),
		'managed-directories': () =>
			getManagedDirectoriesCheck({ context, rootDirectoryService }),
		'pi-agent-directory': () =>
			getPiAgentDirectoryCheck({ context, piReadinessService }),
		'pi-executable': () =>
			getPiExecutableCheck({ context, piExecutableService }),
		'pi-provider-model': () =>
			getPiProviderModelCheck({ context, piReadinessService }),
		'pi-rpc': () => getPiRpcCheck({ context, piReadinessService }),
		'root-directory': () =>
			getRootDirectoryCheck({ context, rootDirectoryService }),
		'shell-process-launch': () =>
			getShellProcessCheck({ context, localCommandService }),
		'sqlite-database': () => getDatabaseCheck({ context, databaseService }),
	};

	return {
		getSnapshot: async () => {
			const checks = await Promise.all(
				SETUP_CHECK_ORDER.map(async (id) => {
					const provider = checkProviders[id] ?? builtInProviders[id];
					const check = await provider(context);

					return sanitizeCheck(check, homeDirectory);
				}),
			);

			return createDiagnosticsSnapshot(checks, now().toISOString());
		},
	};
}

/**
 * Helper that builds a complete {@link SetupCheckSnapshot} from a partial input,
 * defaulting logs, remediation actions and timestamp.
 * @param check - Required fields plus optional overrides for defaults.
 * @returns A fully-populated snapshot.
 */
export function createSetupCheckSnapshot(
	check: Omit<SetupCheckSnapshot, 'logs' | 'remediationActions' | 'updatedAt'> &
		Partial<
			Pick<SetupCheckSnapshot, 'logs' | 'remediationActions' | 'updatedAt'>
		>,
): SetupCheckSnapshot {
	return {
		logs: check.logs ?? [],
		remediationActions: check.remediationActions ?? [
			{
				id: `retry-${check.id}`,
				kind: 'retry',
				label: 'Retry check',
			},
		],
		updatedAt: check.updatedAt ?? new Date(0).toISOString(),
		...check,
	};
}

/** Builds the snapshot for the declarative-config setup check. */
function getConfigCheck({
	configService,
	context,
}: {
	configService: EnsembleConfigService;
	context: SetupCheckProviderContext;
}): SetupCheckSnapshot {
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

	return createSetupCheckSnapshot({
		blocking: true,
		description:
			'Loads ~/.config/ensemble/config.json and validates whether config can be trusted before setup continues.',
		detail,
		group: 'core',
		id: 'config',
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
		title: 'Declarative config',
		updatedAt: context.now().toISOString(),
	});
}

/** Builds the snapshot for the environment-variables setup check. */
async function getEnvironmentVariablesCheck({
	context,
	environmentVariablesService,
}: {
	context: SetupCheckProviderContext;
	environmentVariablesService: EnvironmentVariablesService;
}): Promise<SetupCheckSnapshot> {
	try {
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
		const detail = getEnvironmentVariablesDetail(snapshot);

		return createSetupCheckSnapshot({
			blocking,
			description:
				'Checks the global environment variable catalog and safe secret metadata without printing values.',
			detail,
			group: 'core',
			id: 'environment-variables',
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
			title: 'Environment variables',
			updatedAt: context.now().toISOString(),
		});
	} catch (error) {
		return createSetupCheckSnapshot({
			blocking: false,
			description:
				'Checks the global environment variable catalog and safe secret metadata without printing values.',
			detail:
				error instanceof Error
					? error.message
					: 'Unknown environment variable check error.',
			group: 'core',
			id: 'environment-variables',
			logs: [],
			status: 'warning',
			title: 'Environment variables',
			updatedAt: context.now().toISOString(),
		});
	}
}

/** Builds the snapshot for the SQLite database setup check. */
function getDatabaseCheck({
	context,
	databaseService,
}: {
	context: SetupCheckProviderContext;
	databaseService: EnsembleDatabaseService;
}): SetupCheckSnapshot {
	const database = databaseService.getHealth();
	const status = database.status === 'ok' ? 'success' : 'failure';
	const safePath = formatSafeText(database.path, context.homeDirectory);
	const detail =
		database.status === 'ok'
			? `SQLite opened at ${safePath}; schema version ${database.schemaVersion}.`
			: (database.error ?? `SQLite failed to open at ${safePath}.`);

	return createSetupCheckSnapshot({
		blocking: true,
		description:
			'Opens the local app-support SQLite database and verifies migrations completed.',
		detail,
		group: 'storage',
		id: 'sqlite-database',
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
		title: 'SQLite database',
		updatedAt: context.now().toISOString(),
	});
}

/** Builds the snapshot for the Ensemble root-directory setup check. */
function getRootDirectoryCheck({
	context,
	rootDirectoryService,
}: {
	context: SetupCheckProviderContext;
	rootDirectoryService: EnsembleRootDirectoryService;
}): SetupCheckSnapshot {
	const root =
		rootDirectoryService.getSnapshot() ?? rootDirectoryService.ensure();
	const status =
		root.status === 'ok'
			? 'success'
			: root.status === 'warning'
				? 'warning'
				: 'failure';
	const safePath = formatSafeText(root.path, context.homeDirectory);
	const detail =
		root.diagnostics[0]?.message ?? `Ensemble root is ready at ${safePath}.`;

	return createSetupCheckSnapshot({
		blocking: true,
		description:
			'Validates the configured Ensemble root directory before repositories and workspaces are created.',
		detail,
		group: 'storage',
		id: 'root-directory',
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
							context.homeDirectory,
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
		title: 'Root directory',
		updatedAt: context.now().toISOString(),
	});
}

/** Builds the snapshot for the managed-directories setup check. */
function getManagedDirectoriesCheck({
	context,
	rootDirectoryService,
}: {
	context: SetupCheckProviderContext;
	rootDirectoryService: EnsembleRootDirectoryService;
}): SetupCheckSnapshot {
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

	return createSetupCheckSnapshot({
		blocking: true,
		description:
			'Checks repos, workspaces, and archived-contexts under the selected root.',
		detail,
		group: 'storage',
		id: 'managed-directories',
		logs: root.managedPaths.map((managedPath) => ({
			label: managedPath.key,
			text: `${managedPath.status}: ${formatSafeText(
				managedPath.path,
				context.homeDirectory,
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
		title: 'Managed directories',
		updatedAt: context.now().toISOString(),
	});
}

/** Builds the snapshot for the shell-process-launch setup check. */
async function getShellProcessCheck({
	context,
	localCommandService,
}: {
	context: SetupCheckProviderContext;
	localCommandService: LocalCommandService;
}): Promise<SetupCheckSnapshot> {
	try {
		const environment = await localCommandService.getEnvironment();
		const result = await localCommandService.run({
			args: ['-lc', 'printf ensemble-process-ok'],
			command: environment.shell,
			maxOutputBytes: 1024,
			timeoutMs: 1500,
		});
		const logs: SetupCheckLogSnapshot[] = [
			...environment.diagnostics.map((diagnostic) => ({
				label: diagnostic.code,
				text: diagnostic.message,
			})),
		];

		if (result.logs.stdout) {
			logs.push({
				label: 'stdout',
				text: result.logs.stdout,
				truncated: result.stdoutTruncated,
			});
		}

		if (result.logs.stderr) {
			logs.push({
				label: 'stderr',
				text: result.logs.stderr,
				truncated: result.stderrTruncated,
			});
		}

		if (result.status !== 'success') {
			return createSetupCheckSnapshot({
				blocking: true,
				description:
					'Verifies Electron can launch local commands through the user shell environment.',
				detail:
					result.failure?.message ?? 'The process launch smoke check failed.',
				group: 'core',
				id: 'shell-process-launch',
				logs,
				status: 'failure',
				title: 'Shell and process launch',
				updatedAt: context.now().toISOString(),
			});
		}

		const status =
			environment.source === 'fallback' || environment.diagnostics.length > 0
				? 'warning'
				: 'success';
		const detail =
			status === 'success'
				? 'Commands launch successfully with the shell-derived environment.'
				: 'Commands launch successfully, but shell environment resolution used a fallback.';

		return createSetupCheckSnapshot({
			blocking: true,
			description:
				'Verifies Electron can launch local commands through the user shell environment.',
			detail,
			group: 'core',
			id: 'shell-process-launch',
			logs,
			status,
			title: 'Shell and process launch',
			updatedAt: context.now().toISOString(),
		});
	} catch (error) {
		return createSetupCheckSnapshot({
			blocking: true,
			description:
				'Verifies Electron can launch local commands through the user shell environment.',
			detail: error instanceof Error ? error.message : 'Unknown process error.',
			group: 'core',
			id: 'shell-process-launch',
			logs: [],
			status: 'failure',
			title: 'Shell and process launch',
			updatedAt: context.now().toISOString(),
		});
	}
}

/** Renders the headline detail string for the env-vars check. */
function getEnvironmentVariablesDetail(
	snapshot: EnvironmentVariablesSnapshot,
): string {
	if (snapshot.missingRequiredCount > 0) {
		return `${snapshot.missingRequiredCount} required environment variables are unset.`;
	}

	const configuredCount = snapshot.variables.filter(
		(variable) => variable.status === 'set' || variable.status === 'masked',
	).length;
	const maskedCount = snapshot.variables.filter(
		(variable) => variable.status === 'masked',
	).length;
	const reservedCount = snapshot.variables.filter(
		(variable) => variable.status === 'reserved',
	).length;

	return `${configuredCount} configured variables, ${maskedCount} masked secrets, and ${reservedCount} reserved runtime variables are cataloged.`;
}

/** Renders the per-variable counts and diagnostics as setup check logs. */
function createEnvironmentVariablesLogs(
	snapshot: EnvironmentVariablesSnapshot,
): SetupCheckLogSnapshot[] {
	const configuredCount = snapshot.variables.filter(
		(variable) => variable.status === 'set' || variable.status === 'masked',
	).length;
	const maskedCount = snapshot.variables.filter(
		(variable) => variable.status === 'masked',
	).length;
	const reservedCount = snapshot.variables.filter(
		(variable) => variable.status === 'reserved',
	).length;

	return [
		{
			label: 'Catalog entries',
			text: String(snapshot.catalog.length),
		},
		{
			label: 'Configured variables',
			text: String(configuredCount),
		},
		{
			label: 'Masked secrets',
			text: String(maskedCount),
		},
		{
			label: 'Reserved runtime variables',
			text: String(reservedCount),
		},
		...snapshot.diagnostics.map((diagnostic) => ({
			label: diagnostic.code,
			text: diagnostic.key
				? `${diagnostic.key}: ${diagnostic.message}`
				: diagnostic.message,
		})),
	];
}

/** Renders a {@link LocalCommandResult} as a setup check log set. */
export function createCommandLogs(
	result: LocalCommandResult,
): SetupCheckLogSnapshot[] {
	const logs: SetupCheckLogSnapshot[] = [
		{
			label: 'Command',
			text: result.logs.command,
		},
	];

	if (result.logs.stdout) {
		logs.push({
			label: 'stdout',
			text: result.logs.stdout,
			truncated: result.stdoutTruncated,
		});
	}

	if (result.logs.stderr) {
		logs.push({
			label: 'stderr',
			text: result.logs.stderr,
			truncated: result.stderrTruncated,
		});
	}

	if (result.failure) {
		logs.push({
			label: result.failure.code,
			text: result.failure.message,
		});
	}

	return logs;
}

/** Builds a `pending` setup check snapshot for not-yet-implemented checks. */
function createPendingCheck({
	blocking = true,
	detail,
	group,
	id,
	remediationActions,
	title,
	updatedAt,
}: Pick<SetupCheckSnapshot, 'detail' | 'group' | 'id' | 'title' | 'updatedAt'> &
	Partial<Pick<SetupCheckSnapshot, 'blocking' | 'remediationActions'>>) {
	return createSetupCheckSnapshot({
		blocking,
		description:
			'This setup contract is reserved for the domain implementation ticket.',
		detail,
		group,
		id,
		remediationActions: remediationActions ?? [
			{
				id: `retry-${id}`,
				kind: 'retry',
				label: 'Retry check',
			},
		],
		status: 'pending',
		title,
		updatedAt,
	});
}

/**
 * Aggregates per-check results into the top-level diagnostics snapshot, deriving
 * blocked/checking/ready status from blocking-check outcomes.
 * @param checks - Per-check snapshots, in display order.
 * @param generatedAt - ISO timestamp of the aggregate snapshot.
 * @returns A {@link SetupDiagnosticsSnapshot}.
 */
function createDiagnosticsSnapshot(
	checks: SetupCheckSnapshot[],
	generatedAt: string,
): SetupDiagnosticsSnapshot {
	const requiredChecks = checks.filter((check) => check.blocking);
	const blockedRequiredChecks = requiredChecks.filter(
		(check) => !isPassingStatus(check.status),
	);
	const hasRequiredFailure = blockedRequiredChecks.some(
		(check) => check.status === 'failure',
	);
	const hasRequiredInFlight = blockedRequiredChecks.some(
		(check) => check.status === 'pending' || check.status === 'running',
	);

	return {
		blockedCount: blockedRequiredChecks.length,
		checks,
		generatedAt,
		optionalCount: checks.length - requiredChecks.length,
		requiredCount: requiredChecks.length,
		status:
			blockedRequiredChecks.length === 0
				? 'ready'
				: hasRequiredInFlight && !hasRequiredFailure
					? 'checking'
					: 'blocked',
		successCount: checks.filter((check) => check.status === 'success').length,
		warningCount: checks.filter((check) => check.status === 'warning').length,
	};
}

/** Returns true when the check status counts as a pass (success or warning). */
function isPassingStatus(status: SetupCheckSnapshot['status']): boolean {
	return status === 'success' || status === 'warning';
}

/** Applies home-directory collapse and secret redaction to a check snapshot. */
function sanitizeCheck(
	check: SetupCheckSnapshot,
	homeDirectory: string,
): SetupCheckSnapshot {
	return {
		...check,
		detail: formatSafeText(check.detail, homeDirectory),
		logs: check.logs.map((log) => ({
			...log,
			text: formatSafeText(log.text, homeDirectory),
		})),
	};
}

/**
 * Renders text safely for diagnostic display by collapsing the user's home
 * directory to `~` and redacting GitHub tokens and secret-shaped assignments.
 * @param text - Raw text to sanitise.
 * @param homeDirectory - Home directory to collapse.
 * @returns Safe text suitable for surfacing in the UI.
 */
function formatSafeText(text: string, homeDirectory: string): string {
	const collapsedHome = homeDirectory
		? text.replaceAll(homeDirectory, '~')
		: text;

	return collapsedHome
		.replace(
			SENSITIVE_ASSIGNMENT_PATTERN,
			(_match, key: string, separator: string, quote: string) =>
				`${key}${separator}${quote}[REDACTED]`,
		)
		.replace(GITHUB_TOKEN_PATTERN, '[REDACTED]')
		.replace(TOKEN_LINE_PATTERN, '$1[REDACTED]');
}
