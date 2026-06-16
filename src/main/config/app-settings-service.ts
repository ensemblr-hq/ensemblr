import {
	existsSync,
	type FSWatcher,
	mkdirSync,
	readFileSync,
	renameSync,
	watch,
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
import { resolveEnsembleConfigPath } from './config-loader.ts';

/** Coalesces the burst of fs events an editor emits for a single save. */
const WATCH_DEBOUNCE_MS = 120;

/**
 * Owns the App-settings slice (`app.general`, `app.models`) of
 * `~/.config/ensemble/config.json` — the source of truth. Creates the file with
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

export interface CreateAppSettingsServiceOptions {
	/** Override the config path (tests). Defaults to the real `~/.config` path. */
	configPath?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function createAppSettingsService(
	options: CreateAppSettingsServiceOptions = {},
): AppSettingsService {
	const configPath = options.configPath ?? resolveEnsembleConfigPath();
	// Exact bytes of our last write — the watcher compares against this to ignore
	// the fs event our own atomic write triggers.
	let lastWritten: string | null = null;
	let watcher: FSWatcher | null = null;
	let debounce: ReturnType<typeof setTimeout> | null = null;

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
		// Watch the directory (not the file) so editors that save via
		// rename-replace don't orphan the watcher; filter to our filename.
		const fileName = path.basename(configPath);
		watcher = watch(path.dirname(configPath), (_event, changed) => {
			if (changed && changed !== fileName) {
				return;
			}
			if (debounce) {
				clearTimeout(debounce);
			}
			debounce = setTimeout(() => {
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
			}, WATCH_DEBOUNCE_MS);
		});
	};

	const stop = (): void => {
		if (debounce) {
			clearTimeout(debounce);
			debounce = null;
		}
		watcher?.close();
		watcher = null;
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

function safeParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return {};
	}
}
