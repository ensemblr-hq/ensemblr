/// <reference types="bun" />

import { afterEach, describe, expect, test } from 'bun:test';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAppSettingsService } from '../../src/main/config/app-settings-service';

const created: string[] = [];

function tmpConfigPath(): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'ensemble-cfg-'));
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
	});

	test('update merges a section patch and persists it', () => {
		const configPath = tmpConfigPath();
		const service = createAppSettingsService({ configPath });

		const next = service.update({
			general: { sendShortcut: 'mod+enter' },
			models: { hiddenModels: ['lmstudio/x'] },
		});
		expect(next.general.sendShortcut).toBe('mod+enter');
		expect(next.models.hiddenModels).toEqual(['lmstudio/x']);
		// other fields keep defaults
		expect(next.general.followUpBehavior).toBe('steer');

		// persisted + reflected on re-read
		expect(service.read().general.sendShortcut).toBe('mod+enter');
		expect(readJson(configPath).app.general.sendShortcut).toBe('mod+enter');
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
