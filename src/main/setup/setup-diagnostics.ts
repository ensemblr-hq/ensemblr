import { homedir } from 'node:os';

import type {
	SetupCheckId,
	SetupCheckSnapshot,
	SetupDiagnosticsSnapshot,
	SetupMessageParams,
} from '../../shared/ipc/contracts/setup';
import {
	AGENT_RUNTIME_CHECK_GROUPS,
	isPassingSetupStatus,
} from '../../shared/setup-checks.ts';
import type { AgentProviderExecutableService } from '../agent-providers/agent-provider-types.ts';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsemblrConfigService } from '../config';
import type { EnvironmentVariablesService } from '../environment';
import type { LinearAuthService } from '../linear';
import type { PiExecutableService } from '../pi-runtime';
import type { PiReadinessService } from '../pi-runtime/pi-readiness';
import type { EnsemblrRootDirectoryService } from '../root';
import {
	readSafeStorageStatus,
	type SafeStorageStatus,
} from '../secrets/index.ts';
import type { EnsemblrDatabaseService } from '../storage';
import type { SetupCheckProvider } from './setup-check-context.ts';
import { getClaudeExecutableCheck } from './setup-checks-claude.ts';
import {
	getConfigCheck,
	getDatabaseCheck,
	getEnvironmentVariablesCheck,
	getManagedDirectoriesCheck,
	getRootDirectoryCheck,
	getSecretStorageCheck,
	getShellProcessCheck,
} from './setup-checks-core.ts';
import {
	getGitExecutableCheck,
	getGitHubAuthCheck,
	getGitHubCliCheck,
} from './setup-checks-github.ts';
import { getLinearConnectionCheck } from './setup-checks-linear.ts';
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
	claudeExecutableService: AgentProviderExecutableService;
	configService: EnsemblrConfigService;
	databaseService: EnsemblrDatabaseService;
	environmentVariablesService: EnvironmentVariablesService;
	homeDirectory?: string;
	linearAuthService: LinearAuthService;
	localCommandService: LocalCommandService;
	now?: () => Date;
	piExecutableService: PiExecutableService;
	piReadinessService: PiReadinessService;
	platform?: NodeJS.Platform;
	readSecretStorageStatus?: () => SafeStorageStatus;
	rootDirectoryService: EnsemblrRootDirectoryService;
}

const SETUP_CHECK_ORDER: readonly SetupCheckId[] = [
	'config',
	'sqlite-database',
	'root-directory',
	'managed-directories',
	'shell-process-launch',
	'secret-storage',
	'environment-variables',
	'git-executable',
	'gh-cli',
	'gh-auth',
	'pi-executable',
	'pi-agent-directory',
	'pi-rpc',
	'pi-provider-model',
	'claude-executable',
	'linear-oauth',
];

const AGENT_RUNTIME_CHECK_IDS: readonly (readonly SetupCheckId[])[] =
	Object.values(AGENT_RUNTIME_CHECK_GROUPS);

/**
 * Check ids that only mean something on one platform. macOS keeps its secrets
 * in the Keychain, which the Keychain-backed store already reports on through
 * its own failures, so the keyring row would be a permanently green no-op there.
 */
const PLATFORM_ONLY_CHECK_IDS: Partial<Record<SetupCheckId, NodeJS.Platform>> =
	{
		'secret-storage': 'linux',
	};

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
	claudeExecutableService,
	configService,
	databaseService,
	environmentVariablesService,
	homeDirectory = homedir(),
	linearAuthService,
	localCommandService,
	now = () => new Date(),
	piExecutableService,
	piReadinessService,
	platform = process.platform,
	readSecretStorageStatus = readSafeStorageStatus,
	rootDirectoryService,
}: CreateSetupDiagnosticsServiceOptions): SetupDiagnosticsService {
	const context = { homeDirectory, now };
	const checkOrder = SETUP_CHECK_ORDER.filter((id) => {
		const requiredPlatform = PLATFORM_ONLY_CHECK_IDS[id];
		return !requiredPlatform || requiredPlatform === platform;
	});
	const builtInProviders: Record<SetupCheckId, SetupCheckProvider> = {
		'claude-executable': () =>
			getClaudeExecutableCheck({ claudeExecutableService, context }),
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
			getLinearConnectionCheck({ context, linearAuthService }),
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
		'secret-storage': () =>
			getSecretStorageCheck({ context, readStatus: readSecretStorageStatus }),
		'shell-process-launch': () =>
			getShellProcessCheck({ context, localCommandService }),
		'sqlite-database': () =>
			getDatabaseCheck({ context, databaseService, formatSafeText }),
	};

	return {
		getSnapshot: async () => {
			const checks = await Promise.all(
				checkOrder.map(async (id) => {
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
 * Aggregates per-check results into the top-level diagnostics snapshot, deriving
 * blocked/checking/ready status from blocking-check outcomes.
 * @param checks - Per-check snapshots, in display order.
 * @param generatedAt - ISO timestamp of the aggregate snapshot.
 * @returns A {@link SetupDiagnosticsSnapshot}.
 */
function createDiagnosticsSnapshot(
	rawChecks: SetupCheckSnapshot[],
	generatedAt: string,
): SetupDiagnosticsSnapshot {
	const checks = applyAgentRuntimeGate(rawChecks);
	const requiredChecks = checks.filter((check) => check.blocking);
	const blockedRequiredChecks = requiredChecks.filter(
		(check) => !isPassingSetupStatus(check.status),
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

/**
 * Resolves the either-or agent-runtime gate onto each runtime check's `blocking`
 * flag. Ensemblr drives chats through Pi *or* Claude Code, so a machine carrying
 * one working runtime is ready: the runtime the user did not install must not
 * hold the whole app at `blocked`.
 *
 * With one runtime working, the runtimes that are not are demoted to optional —
 * a broken install of the runtime you never chose is not the app's problem. With
 * none working, every runtime check is promoted to blocking: the app genuinely
 * cannot open a chat, and either runtime would fix it, so neither should read as
 * merely optional.
 * @param checks - Every check snapshot, in display order.
 * @returns The checks with agent-runtime `blocking` flags resolved.
 */
function applyAgentRuntimeGate(
	checks: readonly SetupCheckSnapshot[],
): SetupCheckSnapshot[] {
	const byId = new Map(checks.map((check) => [check.id, check]));
	const isRuntimeSatisfied = (runtimeIds: readonly SetupCheckId[]) =>
		runtimeIds.every((id) => {
			const check = byId.get(id);
			return check ? isPassingSetupStatus(check.status) : false;
		});
	const hasWorkingRuntime = AGENT_RUNTIME_CHECK_IDS.some(isRuntimeSatisfied);
	const coveredIds = new Set(
		AGENT_RUNTIME_CHECK_IDS.filter(
			(runtimeIds) => !isRuntimeSatisfied(runtimeIds),
		).flat(),
	);

	return checks.map((check) => {
		if (!isAgentRuntimeCheck(check.id)) {
			return check;
		}

		const blocking = hasWorkingRuntime
			? check.blocking && !coveredIds.has(check.id)
			: true;

		return blocking === check.blocking ? check : { ...check, blocking };
	});
}

/** True when the check belongs to one of the either-or agent runtimes. */
function isAgentRuntimeCheck(id: SetupCheckId): boolean {
	return AGENT_RUNTIME_CHECK_IDS.some((runtimeIds) => runtimeIds.includes(id));
}

/** Applies home-directory collapse and secret redaction to a check snapshot. */
function sanitizeCheck(
	check: SetupCheckSnapshot,
	homeDirectory: string,
): SetupCheckSnapshot {
	return {
		...check,
		detail: formatSafeText(check.detail, homeDirectory),
		...(check.detailMessage
			? {
					detailMessage: {
						...check.detailMessage,
						...(check.detailMessage.params
							? {
									params: sanitizeMessageParams(
										check.detailMessage.params,
										homeDirectory,
									),
								}
							: {}),
					},
				}
			: {}),
		logs: check.logs.map((log) => ({
			...log,
			text: formatSafeText(log.text, homeDirectory),
		})),
	};
}

/**
 * Redacts the string values a localized message interpolates. Paths and command
 * output reach the renderer as params now, so they need the same treatment the
 * flattened English detail gets.
 * @param params - Interpolation values as the check authored them.
 * @param homeDirectory - Home directory to collapse.
 * @returns The params with every string value sanitised.
 */
function sanitizeMessageParams(
	params: SetupMessageParams,
	homeDirectory: string,
): SetupMessageParams {
	return Object.fromEntries(
		Object.entries(params).map(([key, value]) => [
			key,
			typeof value === 'string' ? formatSafeText(value, homeDirectory) : value,
		]),
	);
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
