import { homedir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { getAgentProviderDescriptor } from '../../shared/agent-provider.ts';
import type { AgentExecutableSelectionWire } from '../../shared/ipc/contracts/agent-provider';
import type {
	ResolvedSettingSnapshot,
	SettingsResolutionSnapshot,
} from '../../shared/ipc/contracts/settings-resolution';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsemblrConfigResolutionService } from '../config';
import { deleteSetting, upsertSetting } from '../environment/settings-table.ts';
import {
	findExecutableOnPath,
	isExecutableFile,
} from '../pi-runtime/executable-discovery.ts';
import {
	findConfiguredPathRejection,
	isBareCommand,
} from '../pi-runtime/internal/configured-executable-path.ts';
import { normalizeConfiguredPath } from '../pi-runtime/internal/normalize-configured-path.ts';
import type { EnsemblrDatabaseService } from '../storage';
import type {
	AgentExecutableResolution,
	AgentProviderExecutableService,
} from './agent-provider-types.ts';

const CLAUDE_DESCRIPTOR = getAgentProviderDescriptor('claude');
const APP_SETTINGS_SCOPE = { scope: 'app', scopeId: '' } as const;

/**
 * Marker source for "no `claude` binary exists on this machine". Ensemblr does
 * not ship the Agent SDK's per-platform runtime — the user installs and
 * authenticates Claude Code themselves — so exhausting the override and PATH
 * tiers is an honest error rather than a silent fallback.
 */
const MISSING_EXECUTABLE_SOURCE = 'missing';

/**
 * Official native installer for Claude Code on macOS, Linux and WSL
 * (code.claude.com/docs/en/setup). Offered as a `run-command` remediation, which
 * every surface copies to the clipboard and never executes. Lives here rather
 * than beside the readiness probe because the setup-diagnostics check needs it
 * too, and `src/main/setup/` cannot import the probe without a module cycle.
 */
export const CLAUDE_INSTALL_COMMAND =
	'curl -fsSL https://claude.ai/install.sh | bash';

/** Official Claude Code setup docs, for the npm route and other platforms. */
export const CLAUDE_SETUP_DOCS_URL = 'https://code.claude.com/docs/en/setup';

/**
 * Claude's resolution, plus the reason an `error` resolution failed. It is
 * structurally an {@link AgentExecutableResolution}, so the provider surface
 * reads it unchanged — the extra field is where Claude carries what Pi carries
 * in its diagnostics array, letting a caller say *why* a configured value was
 * refused instead of only that it "could not be run".
 */
export interface ClaudeExecutableResolution extends AgentExecutableResolution {
	message?: string;
}

/** Options for {@link createClaudeExecutableService}. */
export interface CreateClaudeExecutableServiceOptions {
	databaseService: EnsemblrDatabaseService;
	homeDirectory?: string;
	localCommandService: LocalCommandService;
	settingsResolutionService: EnsemblrConfigResolutionService;
}

/**
 * Builds Claude Code's executable service: discovery through the user's
 * override and then PATH, plus persistence of the override into the app-scope
 * `settings` table.
 * @param options - Service dependencies and the home directory used to expand `~`.
 * @returns An {@link AgentProviderExecutableService} for Claude Code.
 */
export function createClaudeExecutableService({
	databaseService,
	homeDirectory = homedir(),
	localCommandService,
	settingsResolutionService,
}: CreateClaudeExecutableServiceOptions): AgentProviderExecutableService {
	return {
		/** Drops the override so resolution falls back to the `claude` on PATH. */
		clearOverride: () =>
			clearClaudeExecutableOverride(
				databaseService.getConnection()?.database ?? null,
			),
		/** Resolves the executable against the settings as they stand right now. */
		getSnapshot: () =>
			resolveClaudeExecutable({
				homeDirectory,
				localCommandService,
				settingsSnapshot: settingsResolutionService.resolve(),
			}),
		/** Persists the user's chosen executable as the app-scope override. */
		saveOverride: (executablePath) =>
			saveClaudeExecutableOverride(
				databaseService.getConnection()?.database ?? null,
				executablePath,
			),
	};
}

/**
 * Resolves which `claude` binary a first-class Claude session would run: the
 * configured override wins, then the shell-derived PATH. Nothing found is an
 * `error` resolution the readiness probe turns into an install prompt.
 * @param options - Settings snapshot plus PATH and home-directory context.
 * @returns The resolved executable.
 */
export async function resolveClaudeExecutable({
	homeDirectory,
	localCommandService,
	settingsSnapshot,
}: {
	homeDirectory: string;
	localCommandService: LocalCommandService;
	settingsSnapshot: SettingsResolutionSnapshot;
}): Promise<ClaudeExecutableResolution> {
	const setting = findClaudeExecutableSetting(settingsSnapshot);
	const environment = await localCommandService.getEnvironment();

	if (setting) {
		return resolveConfiguredExecutable({
			homeDirectory,
			pathValue: environment.path,
			setting,
		});
	}

	const onPath = findExecutableOnPath(
		CLAUDE_DESCRIPTOR.executableCommand,
		environment.path,
	);

	if (onPath) {
		return { path: onPath, setting: null, source: 'path', status: 'ok' };
	}

	return {
		path: '',
		setting: null,
		source: MISSING_EXECUTABLE_SOURCE,
		status: 'error',
	};
}

/**
 * Validates the user's configured Claude executable: a bare command name is
 * resolved against the shell PATH, a `~`-rooted or absolute path is expanded and
 * checked for the executable bit, and anything relative is refused outright.
 * @param input - The resolved setting plus the PATH and home-directory context.
 * @returns The resolved executable, `error` when the configured value is unusable.
 */
function resolveConfiguredExecutable({
	homeDirectory,
	pathValue,
	setting,
}: {
	homeDirectory: string;
	pathValue: string;
	setting: ResolvedSettingSnapshot;
}): ClaudeExecutableResolution {
	const rawPath = typeof setting.value === 'string' ? setting.value.trim() : '';

	if (!rawPath) {
		return toConfiguredResolution(setting, '');
	}

	if (isBareCommand(rawPath)) {
		return toConfiguredResolution(
			setting,
			findExecutableOnPath(rawPath, pathValue) ?? '',
		);
	}

	const rejection = findConfiguredPathRejection(
		rawPath,
		CLAUDE_DESCRIPTOR.executableSettingKey,
	);

	if (rejection) {
		return { ...toConfiguredResolution(setting, ''), message: rejection };
	}

	return toConfiguredResolution(
		setting,
		normalizeConfiguredPath(rawPath, homeDirectory),
	);
}

/**
 * Wraps a candidate path in a resolution for the configured setting, reporting
 * `error` whenever the candidate is absent or is not a runnable file.
 * @param setting - Setting the candidate came from.
 * @param candidatePath - Absolute candidate path, or an empty string when none resolved.
 * @returns The resolution the provider surface renders.
 */
function toConfiguredResolution(
	setting: ResolvedSettingSnapshot,
	candidatePath: string,
): ClaudeExecutableResolution {
	const runnablePath =
		candidatePath && isExecutableFile(candidatePath) ? candidatePath : '';

	return {
		path: runnablePath,
		setting,
		source: setting.source,
		status: runnablePath ? 'ok' : 'error',
	};
}

/** Picks the resolved `claude.executablePath` setting from the snapshot. */
function findClaudeExecutableSetting(
	settingsSnapshot: SettingsResolutionSnapshot,
): ResolvedSettingSnapshot | null {
	return (
		settingsSnapshot.app.settings.find(
			(setting) => setting.key === CLAUDE_DESCRIPTOR.executableSettingKey,
		) ?? null
	);
}

/**
 * Persists the user's Claude executable override into the app-scope `settings`
 * table under the descriptor's key.
 * @param database - Open SQLite connection, or `null` when storage is down.
 * @param executablePath - Path the user selected or typed.
 * @returns The selection outcome, carrying an error message on failure.
 */
function saveClaudeExecutableOverride(
	database: DatabaseSync | null,
	executablePath: string,
): AgentExecutableSelectionWire {
	const selectedPath = executablePath.trim();

	if (!selectedPath) {
		return {
			canceled: false,
			error: `No ${CLAUDE_DESCRIPTOR.label} executable path was selected.`,
		};
	}

	if (!database) {
		return {
			canceled: false,
			error: `SQLite is unavailable; the ${CLAUDE_DESCRIPTOR.label} executable selection was not saved.`,
		};
	}

	const resolvedPath = path.resolve(selectedPath);

	try {
		upsertSetting({
			database,
			key: CLAUDE_DESCRIPTOR.executableSettingKey,
			scope: APP_SETTINGS_SCOPE,
			valueJson: JSON.stringify(resolvedPath),
		});

		return { canceled: false, selectedPath: resolvedPath };
	} catch (error) {
		return {
			canceled: false,
			error:
				error instanceof Error
					? error.message
					: `Failed to save the ${CLAUDE_DESCRIPTOR.label} executable selection.`,
		};
	}
}

/**
 * Removes the Claude executable override so resolution falls back to whatever
 * `claude` is on PATH.
 * @param database - Open SQLite connection, or `null` when storage is down.
 * @returns The selection outcome, carrying an error message on failure.
 */
function clearClaudeExecutableOverride(
	database: DatabaseSync | null,
): AgentExecutableSelectionWire {
	if (!database) {
		return {
			canceled: false,
			error: `SQLite is unavailable; the ${CLAUDE_DESCRIPTOR.label} executable override was not cleared.`,
		};
	}

	try {
		deleteSetting({
			database,
			key: CLAUDE_DESCRIPTOR.executableSettingKey,
			scope: APP_SETTINGS_SCOPE,
		});

		return { canceled: false };
	} catch (error) {
		return {
			canceled: false,
			error:
				error instanceof Error
					? error.message
					: `Failed to clear the ${CLAUDE_DESCRIPTOR.label} executable override.`,
		};
	}
}
