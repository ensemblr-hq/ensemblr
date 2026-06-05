import { homedir } from 'node:os';

import type {
	SetupCheckId,
	SetupCheckLogSnapshot,
	SetupCheckSnapshot,
	SetupDiagnosticsSnapshot,
} from '../../shared/ipc';
import type { LocalCommandService } from '../commands/local-command';
import type { PiductorConfigService } from '../config/config-loader';
import type { PiductorRootDirectoryService } from '../root/root-directory';
import type { PiductorDatabaseService } from '../storage/database';

export interface SetupDiagnosticsService {
	getSnapshot: () => Promise<SetupDiagnosticsSnapshot>;
}

export interface SetupCheckProviderContext {
	homeDirectory: string;
	now: () => Date;
}

export type SetupCheckProvider = (
	context: SetupCheckProviderContext,
) => Promise<SetupCheckSnapshot> | SetupCheckSnapshot;

interface CreateSetupDiagnosticsServiceOptions {
	checkProviders?: Partial<Record<SetupCheckId, SetupCheckProvider>>;
	configService: PiductorConfigService;
	databaseService: PiductorDatabaseService;
	homeDirectory?: string;
	localCommandService: LocalCommandService;
	now?: () => Date;
	rootDirectoryService: PiductorRootDirectoryService;
}

const SETUP_CHECK_ORDER: readonly SetupCheckId[] = [
	'config',
	'sqlite-database',
	'root-directory',
	'managed-directories',
	'shell-process-launch',
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

export function createSetupDiagnosticsService({
	checkProviders = {},
	configService,
	databaseService,
	homeDirectory = homedir(),
	localCommandService,
	now = () => new Date(),
	rootDirectoryService,
}: CreateSetupDiagnosticsServiceOptions): SetupDiagnosticsService {
	const context = { homeDirectory, now };
	const builtInProviders: Record<SetupCheckId, SetupCheckProvider> = {
		config: () => getConfigCheck({ configService, context }),
		'gh-auth': () =>
			createPendingCheck({
				detail:
					'GitHub CLI authentication will be verified by THE-110. Run gh auth login before retrying when this check is implemented.',
				group: 'github',
				id: 'gh-auth',
				title: 'GitHub CLI authenticated',
				updatedAt: now().toISOString(),
			}),
		'gh-cli': () =>
			createPendingCheck({
				detail:
					'GitHub CLI executable detection will be implemented by THE-110. Install gh before continuing with PR/check workflows.',
				group: 'github',
				id: 'gh-cli',
				title: 'GitHub CLI installed',
				updatedAt: now().toISOString(),
			}),
		'git-executable': () =>
			createPendingCheck({
				detail:
					'Git executable detection will be implemented by THE-110. Install git or Xcode Command Line Tools before retrying.',
				group: 'github',
				id: 'git-executable',
				title: 'Git executable',
				updatedAt: now().toISOString(),
			}),
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
			createPendingCheck({
				detail:
					'Pi agent directory discovery will be implemented by THE-112. Piductor will preserve the normal Pi environment by default.',
				group: 'pi',
				id: 'pi-agent-directory',
				title: 'Pi agent directory',
				updatedAt: now().toISOString(),
			}),
		'pi-executable': () =>
			createPendingCheck({
				detail:
					'Pi executable discovery and overrides will be implemented by THE-111.',
				group: 'pi',
				id: 'pi-executable',
				title: 'Pi executable',
				updatedAt: now().toISOString(),
			}),
		'pi-provider-model': () =>
			createPendingCheck({
				detail:
					'Pi provider and model readiness will be implemented by THE-112.',
				group: 'pi',
				id: 'pi-provider-model',
				title: 'Pi provider and model readiness',
				updatedAt: now().toISOString(),
			}),
		'pi-rpc': () =>
			createPendingCheck({
				detail: 'Pi RPC smoke checks will be implemented by THE-112.',
				group: 'pi',
				id: 'pi-rpc',
				title: 'Pi RPC startup',
				updatedAt: now().toISOString(),
			}),
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

function getConfigCheck({
	configService,
	context,
}: {
	configService: PiductorConfigService;
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
			'Loads ~/.config/piductor/config.json and validates whether config can be trusted before setup continues.',
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

function getDatabaseCheck({
	context,
	databaseService,
}: {
	context: SetupCheckProviderContext;
	databaseService: PiductorDatabaseService;
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

function getRootDirectoryCheck({
	context,
	rootDirectoryService,
}: {
	context: SetupCheckProviderContext;
	rootDirectoryService: PiductorRootDirectoryService;
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
		root.diagnostics[0]?.message ?? `Piductor root is ready at ${safePath}.`;

	return createSetupCheckSnapshot({
		blocking: true,
		description:
			'Validates the configured Piductor root directory before repositories and workspaces are created.',
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

function getManagedDirectoriesCheck({
	context,
	rootDirectoryService,
}: {
	context: SetupCheckProviderContext;
	rootDirectoryService: PiductorRootDirectoryService;
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
			args: ['-lc', 'printf piductor-process-ok'],
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

function isPassingStatus(status: SetupCheckSnapshot['status']): boolean {
	return status === 'success' || status === 'warning';
}

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

function formatSafeText(text: string, homeDirectory: string): string {
	const collapsedHome = homeDirectory
		? text.replaceAll(homeDirectory, '~')
		: text;

	return collapsedHome.replace(
		SENSITIVE_ASSIGNMENT_PATTERN,
		(_match, key: string, separator: string, quote: string) =>
			`${key}${separator}${quote}[REDACTED]`,
	);
}
