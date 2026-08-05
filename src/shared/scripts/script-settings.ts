import type { WorkspaceScriptKind } from '../ipc/contracts/workspace-scripts';
import {
	DEFAULT_RUN_SCRIPT_ICON,
	LEGACY_RUN_SCRIPT_NAME,
	normalizeRunScripts,
	type RunScriptDefinition,
	selectAvailableRunScripts,
} from './run-scripts.ts';

/**
 * Single source of truth for reading repository script configuration out of a
 * resolved settings list. Used by the main-process script lifecycle service
 * and the renderer dock; keeping one parser prevents the two processes from
 * drifting on key names or defaults.
 */

/** Minimal shape of one resolved setting entry. */
export interface ResolvedScriptSettingEntry {
	key: string;
	value: unknown;
}

/** Run-script concurrency mode (ADR 0007). */
export type RunScriptMode = 'concurrent' | 'nonconcurrent';

/** Script kinds configured as a single command, unlike the named run scripts. */
export type SingleCommandScriptKind = Exclude<WorkspaceScriptKind, 'run'>;

/** Parsed repository script configuration. */
export interface WorkspaceScriptSettings {
	/** When true, the default run script auto-starts after setup exits 0. */
	autoRunAfterSetup: boolean;
	/** Named run scripts offered by the dock's Run button, in declaration order. */
	runScripts: RunScriptDefinition[];
	runScriptMode: RunScriptMode;
	scripts: Partial<Record<SingleCommandScriptKind, string>>;
}

const SINGLE_COMMAND_SCRIPT_KINDS = ['archive', 'setup'] as const;

/**
 * Extracts the configured script commands, named run scripts, run mode, and
 * auto-run flag from resolved repository settings. Blank or non-string commands
 * are treated as unconfigured; unknown run modes fall back to `concurrent`.
 * @param settings - Resolved settings entries (repository scope).
 * @returns The parsed {@link WorkspaceScriptSettings}.
 */
export function parseWorkspaceScriptSettings(
	settings: readonly ResolvedScriptSettingEntry[],
): WorkspaceScriptSettings {
	const scripts: Partial<Record<SingleCommandScriptKind, string>> = {};

	for (const kind of SINGLE_COMMAND_SCRIPT_KINDS) {
		const command = readCommand(settings, `scripts.${kind}`);

		if (command) {
			scripts[kind] = command;
		}
	}

	const runModeValue = findValue(settings, 'runScriptMode');
	const autoRunValue = findValue(settings, 'autoRunAfterSetup');

	return {
		autoRunAfterSetup: autoRunValue === true,
		runScriptMode:
			runModeValue === 'nonconcurrent' ? 'nonconcurrent' : 'concurrent',
		runScripts: selectAvailableRunScripts(readConfiguredRunScripts(settings)),
		scripts,
	};
}

/**
 * Resolves every run script the repository configures, including those gated to
 * an environment Ensemblr does not launch, and upgrades a legacy `scripts.run`
 * string into an implicit default script when no named list is configured. The
 * Scripts settings screen edits this list, so a script it cannot offer still
 * survives a save instead of being silently dropped.
 * @param settings - Resolved settings entries (repository scope).
 * @returns The configured run scripts, in declaration order.
 */
export function readConfiguredRunScripts(
	settings: readonly ResolvedScriptSettingEntry[],
): RunScriptDefinition[] {
	const named = normalizeRunScripts(findValue(settings, 'scripts.runScripts'));

	if (named.length > 0) {
		return named;
	}

	const legacyCommand = readCommand(settings, 'scripts.run');

	if (!legacyCommand) {
		return [];
	}

	return [
		{
			availableIn: null,
			command: legacyCommand,
			icon: DEFAULT_RUN_SCRIPT_ICON,
			isDefault: true,
			name: LEGACY_RUN_SCRIPT_NAME,
		},
	];
}

/**
 * Reads a script command, treating blank and non-string values as unconfigured.
 * @param settings - Resolved settings entries.
 * @param key - Resolver key holding the command.
 * @returns The command, or null.
 */
function readCommand(
	settings: readonly ResolvedScriptSettingEntry[],
	key: string,
): string | null {
	const value = findValue(settings, key);

	return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * Looks up one resolved setting value by key.
 * @param settings - Resolved settings entries.
 * @param key - Resolver key.
 * @returns The value, or undefined when the key is absent.
 */
function findValue(
	settings: readonly ResolvedScriptSettingEntry[],
	key: string,
): unknown {
	return settings.find((setting) => setting.key === key)?.value;
}
