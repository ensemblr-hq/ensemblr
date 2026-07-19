import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
	type AppSettings,
	type AppSettingsPatch,
	DEFAULT_APP_SETTINGS,
	mergeAppSettings,
	parseAppSettings,
} from '../../shared/config/app-settings.ts';
import { resolveEnsemblrConfigPath } from './config-loader.ts';
import { watchConfigFile } from './watch-config-file.ts';

/** Coalesces the burst of fs events an editor emits for a single save. */
const WATCH_DEBOUNCE_MS = 120;

/**
 * Owns the App-settings slice (`app.general`, `app.models`, `app.git`,
 * `app.appearance`, `app.experimental`) of
 * `~/.config/ensemblr/config.json` — the source of truth. Creates the file with
 * defaults on first use, applies section-scoped patches via an atomic
 * temp-write+rename, and watches for external edits (echo-suppressed against its
 * own writes). Other config keys are preserved untouched.
 */
export interface AppSettingsService {
	getPath(): string;
	ensureExists(): void;
	read(): AppSettings;
	update(patch: AppSettingsPatch): AppSettings;
	/** Begins watching; `onChange` fires only for edits made outside the app. */
	startWatching(onChange: (settings: AppSettings) => void): void;
	stop(): void;
}

/** Options for creating the app-settings service. */
export interface CreateAppSettingsServiceOptions {
	/** Override the config path (tests). Defaults to the real `~/.config` path. */
	configPath?: string;
}

/**
 * Coerce an unknown value into a plain record, treating non-objects and arrays as empty.
 * @param value - Value to coerce
 * @returns The value as a record, or an empty record when it is not a plain object
 */
function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/**
 * Create the service that reads, writes, and watches the app settings section
 * of the on-disk config, ignoring the filesystem events from its own writes.
 * @param options - Optional overrides such as the config path
 * @returns The app-settings service
 */
export function createAppSettingsService(
	options: CreateAppSettingsServiceOptions = {},
): AppSettingsService {
	const configPath = options.configPath ?? resolveEnsemblrConfigPath();
	// Exact bytes of our last write — the watcher compares against this to ignore
	// the fs event our own atomic write triggers.
	let lastWritten: string | null = null;
	let watcherHandle: { stop: () => void } | null = null;

	const readRaw = (): Record<string, unknown> => {
		try {
			return asRecord(JSON.parse(readFileSync(configPath, 'utf8')));
		} catch {
			return {};
		}
	};

	const writeRaw = (config: Record<string, unknown>): void => {
		const serialized = `${JSON.stringify(config, null, 2)}\n`;
		mkdirSync(path.dirname(configPath), { recursive: true });
		const tempPath = `${configPath}.tmp`;
		writeFileSync(tempPath, serialized, 'utf8');
		renameSync(tempPath, configPath);
		lastWritten = serialized;
	};

	const settingsFrom = (config: Record<string, unknown>): AppSettings => {
		const app = asRecord(config.app);
		return parseAppSettings({
			general: app.general,
			models: app.models,
			git: app.git,
			appearance: app.appearance,
			experimental: app.experimental,
		});
	};

	const ensureExists = (): void => {
		if (existsSync(configPath)) {
			return;
		}
		writeRaw({
			schemaVersion: 1,
			app: {
				general: DEFAULT_APP_SETTINGS.general,
				models: DEFAULT_APP_SETTINGS.models,
				git: DEFAULT_APP_SETTINGS.git,
				appearance: DEFAULT_APP_SETTINGS.appearance,
				experimental: DEFAULT_APP_SETTINGS.experimental,
			},
		});
	};

	const read = (): AppSettings => {
		ensureExists();
		return settingsFrom(readRaw());
	};

	const update = (patch: AppSettingsPatch): AppSettings => {
		ensureExists();
		const config = readRaw();
		const app = asRecord(config.app);
		const next = mergeAppSettings(settingsFrom(config), patch);
		writeRaw({
			...config,
			schemaVersion:
				typeof config.schemaVersion === 'number' ? config.schemaVersion : 1,
			app: {
				...app,
				general: next.general,
				models: next.models,
				git: next.git,
				appearance: next.appearance,
				experimental: next.experimental,
			},
		});
		return next;
	};

	const startWatching = (onChange: (settings: AppSettings) => void): void => {
		ensureExists();
		try {
			lastWritten = readFileSync(configPath, 'utf8');
		} catch {
			lastWritten = null;
		}
		watcherHandle = watchConfigFile({
			debounceMs: WATCH_DEBOUNCE_MS,
			filePath: configPath,
			onChange: () => {
				let current: string;
				try {
					current = readFileSync(configPath, 'utf8');
				} catch {
					return;
				}
				if (current === lastWritten) {
					return; // our own write — ignore the echo
				}
				lastWritten = current;
				onChange(settingsFrom(asRecord(safeParse(current))));
			},
		});
	};

	const stop = (): void => {
		watcherHandle?.stop();
		watcherHandle = null;
	};

	return {
		getPath: () => configPath,
		ensureExists,
		read,
		update,
		startWatching,
		stop,
	};
}

/**
 * Parse JSON text, returning an empty object rather than throwing on malformed input.
 * @param text - JSON text to parse
 * @returns The parsed value, or an empty object when parsing fails
 */
function safeParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return {};
	}
}
