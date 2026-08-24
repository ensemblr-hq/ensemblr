import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createAppSettingsService } from '../../src/main/config/app-settings-service';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/config';

const created: string[] = [];

function tmpConfigPath(): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'ensemblr-cfg-'));
	created.push(dir);
	return path.join(dir, 'config.json');
}

// biome-ignore lint/suspicious/noExplicitAny: test reads arbitrary JSON shapes.
function readJson(file: string): Record<string, any> {
	return JSON.parse(readFileSync(file, 'utf8'));
}

afterEach(() => {
	for (const dir of created.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe('createAppSettingsService', () => {
	// The service used to name its sections three times over — once to read, once
	// to seed a new file, once to write back — and `app.concierge` was missed on
	// all three. It wrote to disk and vanished on every read, so the Concierge's
	// model picker looked inert and its sessions kept opening on the default
	// runtime. These three hold every section the schema declares.
	test.each(Object.keys(DEFAULT_APP_SETTINGS))(
		'seeds a new config.json with the %s section',
		(section) => {
			const configPath = tmpConfigPath();
			createAppSettingsService({ configPath }).read();

			expect(readJson(configPath).app).toHaveProperty(section);
		},
	);

	test.each(Object.keys(DEFAULT_APP_SETTINGS))(
		'reads the %s section back rather than dropping it',
		(section) => {
			const configPath = tmpConfigPath();
			const service = createAppSettingsService({ configPath });

			expect(service.read()).toHaveProperty(section);
		},
	);

	test('round-trips the Concierge runtime a picker writes', () => {
		const configPath = tmpConfigPath();
		const service = createAppSettingsService({ configPath });

		service.update({ concierge: { model: 'opus[1m]', provider: 'claude' } });

		expect(service.read().concierge).toMatchObject({
			model: 'opus[1m]',
			provider: 'claude',
		});
		expect(
			createAppSettingsService({ configPath }).read().concierge,
		).toMatchObject({ model: 'opus[1m]', provider: 'claude' });
	});

	test.each(Object.keys(DEFAULT_APP_SETTINGS))(
		'preserves the %s section across an unrelated write',
		(section) => {
			const configPath = tmpConfigPath();
			const service = createAppSettingsService({ configPath });
			service.read();

			service.update({ general: { sendShortcut: 'mod+enter' } });

			expect(readJson(configPath).app).toHaveProperty(section);
		},
	);

	test('creates config.json with defaults on first read', () => {
		const configPath = tmpConfigPath();
		const service = createAppSettingsService({ configPath });
		expect(existsSync(configPath)).toBe(false);

		const settings = service.read();
		expect(existsSync(configPath)).toBe(true);
		expect(settings.general.sendShortcut).toBe('enter');

		const onDisk = readJson(configPath);
		expect(onDisk.schemaVersion).toBe(1);
		expect(onDisk.app.general.sendShortcut).toBe('enter');
		expect(onDisk.app.models.hiddenModels).toEqual([]);
		expect(onDisk.app.experimental.autoRunAfterSetup).toBe(false);
	});

	test('update merges a section patch and persists it', () => {
		const configPath = tmpConfigPath();
		const service = createAppSettingsService({ configPath });

		const next = service.update({
			experimental: { autoRunAfterSetup: true },
			general: { sendShortcut: 'mod+enter' },
			models: { hiddenModels: ['lmstudio/x'] },
		});
		expect(next.general.sendShortcut).toBe('mod+enter');
		expect(next.models.hiddenModels).toEqual(['lmstudio/x']);
		expect(next.experimental.autoRunAfterSetup).toBe(true);
		// other fields keep defaults
		expect(next.general.followUpBehavior).toBe('steer');

		// persisted + reflected on re-read
		expect(service.read().general.sendShortcut).toBe('mod+enter');
		expect(readJson(configPath).app.general.sendShortcut).toBe('mod+enter');
		expect(readJson(configPath).app.experimental.autoRunAfterSetup).toBe(true);
	});

	test('persists git section defaults and updates', () => {
		const configPath = tmpConfigPath();
		const service = createAppSettingsService({ configPath });

		expect(service.read().git.setUpstreamOnPush).toBe(true);
		expect(readJson(configPath).app.git.branchPrefixSource).toBe(
			'github-username',
		);

		const next = service.update({
			git: { archiveAfterMerge: true, branchPrefixSource: 'none' },
		});
		expect(next.git.archiveAfterMerge).toBe(true);
		expect(next.git.branchPrefixSource).toBe('none');
		expect(next.git.setUpstreamOnPush).toBe(true); // untouched default

		expect(service.read().git.archiveAfterMerge).toBe(true);
		expect(readJson(configPath).app.git.branchPrefixSource).toBe('none');
	});

	test('preserves unrelated config keys when writing', () => {
		const configPath = tmpConfigPath();
		writeFileSync(
			configPath,
			JSON.stringify({
				app: { ui: { density: 'cozy' } },
				schemaVersion: 1,
				security: { trustManaged: true },
			}),
		);
		const service = createAppSettingsService({ configPath });

		service.update({ general: { desktopNotifications: false } });

		const onDisk = readJson(configPath);
		expect(onDisk.security).toEqual({ trustManaged: true });
		expect(onDisk.app.ui).toEqual({ density: 'cozy' });
		expect(onDisk.app.general.desktopNotifications).toBe(false);
	});

	test('persists dictation settings and reads them back', () => {
		const configPath = tmpConfigPath();
		const service = createAppSettingsService({ configPath });

		const next = service.update({
			dictation: { enabled: true, model: 'whisper-1' },
		});
		expect(next.dictation.enabled).toBe(true);
		expect(next.dictation.model).toBe('whisper-1');
		expect(next.dictation.baseUrl).toBe('https://api.openai.com/v1');

		expect(service.read().dictation.enabled).toBe(true);
		expect(readJson(configPath).app.dictation.model).toBe('whisper-1');
	});

	test('writes a $schema pointer into the config it creates', () => {
		const configPath = tmpConfigPath();
		createAppSettingsService({ configPath }).read();

		expect(readJson(configPath).$schema).toContain('config.schema.json');
	});

	test('reads externally-written values, defaulting invalid fields', () => {
		const configPath = tmpConfigPath();
		writeFileSync(
			configPath,
			JSON.stringify({
				app: {
					general: { toolCallCollapse: 'nope', sendShortcut: 'mod+enter' },
				},
			}),
		);
		const service = createAppSettingsService({ configPath });

		const settings = service.read();
		expect(settings.general.sendShortcut).toBe('mod+enter');
		expect(settings.general.toolCallCollapse).toBe('collapsed');
	});
});
