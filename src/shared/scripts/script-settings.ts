import type { WorkspaceScriptKind } from '../ipc/contracts/workspace-scripts';

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

/** Parsed repository script configuration. */
export interface WorkspaceScriptSettings {
	runScriptMode: RunScriptMode;
	scripts: Partial<Record<WorkspaceScriptKind, string>>;
}

const SCRIPT_KINDS = ['archive', 'run', 'setup'] as const;

/**
 * Extracts the configured script commands and run mode from resolved
 * repository settings. Blank or non-string commands are treated as
 * unconfigured; unknown run modes fall back to `concurrent`.
 * @param settings - Resolved settings entries (repository scope).
 * @returns The parsed {@link WorkspaceScriptSettings}.
 */
export function parseWorkspaceScriptSettings(
	settings: readonly ResolvedScriptSettingEntry[],
): WorkspaceScriptSettings {
	const scripts: Partial<Record<WorkspaceScriptKind, string>> = {};

	for (const kind of SCRIPT_KINDS) {
		const value = settings.find(
			(setting) => setting.key === `scripts.${kind}`,
		)?.value;

		if (typeof value === 'string' && value.trim()) {
			scripts[kind] = value;
		}
	}

	const runModeValue = settings.find(
		(setting) => setting.key === 'runScriptMode',
	)?.value;

	return {
		runScriptMode:
			runModeValue === 'nonconcurrent' ? 'nonconcurrent' : 'concurrent',
		scripts,
	};
}
