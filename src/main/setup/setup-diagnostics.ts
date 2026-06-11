import { homedir } from 'node:os';

import type {
	SetupCheckId,
	SetupCheckSnapshot,
	SetupDiagnosticsSnapshot,
} from '../../shared/ipc';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsembleConfigService } from '../config/config-loader';
import type { EnvironmentVariablesService } from '../environment/environment-variables';
import type { PiExecutableService } from '../pi-runtime/pi-executable';
import type { PiReadinessService } from '../pi-runtime/pi-readiness';
import type { EnsembleRootDirectoryService } from '../root/root-directory-service';
import type { EnsembleDatabaseService } from '../storage/database';
import {
	createSetupCheckSnapshot,
	type SetupCheckProvider,
} from './setup-check-context.ts';
import {
	getConfigCheck,
	getDatabaseCheck,
	getEnvironmentVariablesCheck,
	getManagedDirectoriesCheck,
	getRootDirectoryCheck,
	getShellProcessCheck,
} from './setup-checks-core.ts';
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
			getManagedDirectoriesCheck({
				context,
				formatSafeText,
				rootDirectoryService,
			}),
		'pi-agent-directory': () =>
			getPiAgentDirectoryCheck({ context, piReadinessService }),
		'pi-executable': () =>
			getPiExecutableCheck({ context, piExecutableService }),
		'pi-provider-model': () =>
			getPiProviderModelCheck({ context, piReadinessService }),
		'pi-rpc': () => getPiRpcCheck({ context, piReadinessService }),
		'root-directory': () =>
			getRootDirectoryCheck({ context, formatSafeText, rootDirectoryService }),
		'shell-process-launch': () =>
			getShellProcessCheck({ context, localCommandService }),
		'sqlite-database': () =>
			getDatabaseCheck({ context, databaseService, formatSafeText }),
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
