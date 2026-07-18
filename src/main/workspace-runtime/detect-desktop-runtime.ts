import type {
	DesktopFramework,
	WorkspaceDesktopRuntime,
} from '../../shared/ipc/contracts/workspace-runtime.ts';

/**
 * Inputs the pure detector folds into a runtime verdict: the parsed
 * `package.json`, the resolved run command, and a parsed Tauri config. Any of
 * them may be null when the file is absent or unparseable.
 */
export interface DesktopRuntimeSignals {
	packageJson: unknown;
	runCommand: string | null;
	tauriConf: unknown;
}

/** Dependency names that identify an Electron project. */
const ELECTRON_DEP_PATTERNS = [
	/^electron$/,
	/^electron-builder$/,
	/^@electron-forge\//,
	/^electron-vite$/,
];

/** Dependency names that identify a Tauri project. */
const TAURI_DEP_PATTERNS = [/^@tauri-apps\//, /^tauri$/];

/** Run-command tokens that identify an Electron project when deps miss it. */
const ELECTRON_COMMAND_PATTERN = /\belectron(-forge|-vite)?\b/;

/** Run-command tokens that identify a Tauri project when deps miss it. */
const TAURI_COMMAND_PATTERN = /\btauri\b/;

/**
 * Decides whether a workspace is an Electron or Tauri desktop app from its
 * manifest and run command, and resolves the macOS app name used to focus it.
 * Deps are the primary signal; the run command is a fallback for globally
 * installed CLIs that never appear in `package.json`. Returns `null` for plain
 * web/server projects.
 * @param signals - Parsed package.json, resolved run command, and Tauri config.
 * @returns The detected desktop runtime, or `null` when none matches.
 */
export function detectDesktopRuntime(
	signals: DesktopRuntimeSignals,
): WorkspaceDesktopRuntime | null {
	const framework = detectFramework(signals);

	if (!framework) {
		return null;
	}

	return { appName: resolveAppName(framework, signals), framework };
}

/** Picks the desktop framework from deps first, then the run command. */
function detectFramework(
	signals: DesktopRuntimeSignals,
): DesktopFramework | null {
	const deps = collectDependencyNames(signals.packageJson);
	const command = signals.runCommand ?? '';

	if (
		matchesAny(deps, TAURI_DEP_PATTERNS) ||
		TAURI_COMMAND_PATTERN.test(command)
	) {
		return 'tauri';
	}

	if (
		matchesAny(deps, ELECTRON_DEP_PATTERNS) ||
		ELECTRON_COMMAND_PATTERN.test(command)
	) {
		return 'electron';
	}

	return null;
}

/**
 * Resolves the macOS application name to focus a running window: Tauri and
 * electron-builder expose a `productName`; otherwise fall back to the package
 * `name`. Returns null when nothing usable is present.
 */
function resolveAppName(
	framework: DesktopFramework,
	signals: DesktopRuntimeSignals,
): string | null {
	const packageJson = asRecord(signals.packageJson);
	const candidates =
		framework === 'tauri'
			? [readTauriProductName(signals.tauriConf), packageJson?.productName]
			: [asRecord(packageJson?.build)?.productName, packageJson?.productName];

	return firstString([...candidates, packageJson?.name]);
}

/** Reads the Tauri product name across v1 (`package.productName`) and v2 layouts. */
function readTauriProductName(tauriConf: unknown): string | null {
	const conf = asRecord(tauriConf);

	return conf
		? firstString([conf.productName, asRecord(conf.package)?.productName])
		: null;
}

/** Returns the first value in `values` that reads as a non-empty string, or null. */
function firstString(values: unknown[]): string | null {
	for (const value of values) {
		const text = readString(value);

		if (text) {
			return text;
		}
	}

	return null;
}

/** Flattens the dependency + devDependency keys from a package.json record. */
function collectDependencyNames(packageJson: unknown): string[] {
	const record = asRecord(packageJson);

	if (!record) {
		return [];
	}

	return [
		...Object.keys(asRecord(record.dependencies) ?? {}),
		...Object.keys(asRecord(record.devDependencies) ?? {}),
	];
}

/** True when any name matches any pattern. */
function matchesAny(names: string[], patterns: RegExp[]): boolean {
	return names.some((name) => patterns.some((pattern) => pattern.test(name)));
}

/** Narrows an unknown value to a plain record, or null. */
function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/** Returns a trimmed non-empty string, or null for anything else. */
function readString(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const trimmed = value.trim();

	return trimmed.length > 0 ? trimmed : null;
}
