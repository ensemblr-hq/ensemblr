import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { readLinuxBattery } from '../../src/main/agent-runtime/linux-battery';

/**
 * Builds a fake `/sys/class/power_supply` tree, so the reader is exercised
 * against real files rather than a mocked `fs`.
 * @param supplies - Directory name to attribute map, e.g. `{ BAT0: { capacity: '87' } }`.
 * @returns The absolute path to the fake power-supply root.
 */
async function createPowerSupplyRoot(
	supplies: Record<string, Record<string, string>>,
): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), 'ensemblr-battery-'));
	for (const [name, attributes] of Object.entries(supplies)) {
		const directory = path.join(root, name);
		await mkdir(directory, { recursive: true });
		for (const [attribute, value] of Object.entries(attributes)) {
			await writeFile(path.join(directory, attribute), `${value}\n`, 'utf8');
		}
	}
	return root;
}

const createdRoots: string[] = [];
const REAL_PLATFORM = process.platform;

/**
 * Creates a fake power-supply tree and registers it for cleanup.
 * @param supplies - Directory name to attribute map.
 * @returns The absolute path to the fake power-supply root.
 */
async function withRoot(
	supplies: Record<string, Record<string, string>>,
): Promise<string> {
	const root = await createPowerSupplyRoot(supplies);
	createdRoots.push(root);
	return root;
}

afterEach(async () => {
	Object.defineProperty(process, 'platform', {
		configurable: true,
		value: REAL_PLATFORM,
	});
	await Promise.all(
		createdRoots.splice(0).map((root) => rm(root, { recursive: true })),
	);
});

/**
 * Overrides the reported platform for the duration of one test, so the reader's
 * Linux-only guard can be exercised from a macOS or CI host.
 * @param platform - Platform value the test wants `process.platform` to report.
 */
function pretendPlatform(platform: NodeJS.Platform): void {
	Object.defineProperty(process, 'platform', {
		configurable: true,
		value: platform,
	});
}

describe('readLinuxBattery', () => {
	test('reads a discharging battery', async () => {
		pretendPlatform('linux');
		const root = await withRoot({
			BAT0: { capacity: '87', status: 'Discharging' },
		});
		await expect(readLinuxBattery(root)).resolves.toEqual({
			charging: false,
			percent: 87,
		});
	});

	test('reads a charging battery', async () => {
		pretendPlatform('linux');
		const root = await withRoot({
			BAT0: { capacity: '42', status: 'Charging' },
		});
		await expect(readLinuxBattery(root)).resolves.toEqual({
			charging: true,
			percent: 42,
		});
	});

	test('treats a Full battery as on AC rather than draining', async () => {
		pretendPlatform('linux');
		const root = await withRoot({ BAT0: { capacity: '100', status: 'Full' } });
		await expect(readLinuxBattery(root)).resolves.toEqual({
			charging: true,
			percent: 100,
		});
	});

	test('treats "Not charging" as on AC', async () => {
		pretendPlatform('linux');
		const root = await withRoot({
			BAT1: { capacity: '78', status: 'Not charging' },
		});
		await expect(readLinuxBattery(root)).resolves.toEqual({
			charging: true,
			percent: 78,
		});
	});

	test('falls through a battery with no capacity to the next one', async () => {
		pretendPlatform('linux');
		const root = await withRoot({
			BAT0: { status: 'Discharging' },
			BAT1: { capacity: '55', status: 'Discharging' },
		});
		await expect(readLinuxBattery(root)).resolves.toEqual({
			charging: false,
			percent: 55,
		});
	});

	test('assumes discharging when the status attribute is missing', async () => {
		pretendPlatform('linux');
		const root = await withRoot({ BAT0: { capacity: '31' } });
		await expect(readLinuxBattery(root)).resolves.toEqual({
			charging: false,
			percent: 31,
		});
	});

	// A pack the vendor did not name `BAT*` — `CMB0` on several ThinkPads, and
	// `macsmc-battery` on Asahi — is still a battery, and the `type` attribute is
	// where the kernel says so.
	test('finds a battery whose directory is not named BAT*', async () => {
		pretendPlatform('linux');
		const root = await withRoot({
			'macsmc-battery': {
				capacity: '64',
				status: 'Discharging',
				type: 'Battery',
			},
		});
		await expect(readLinuxBattery(root)).resolves.toEqual({
			charging: false,
			percent: 64,
		});
	});

	test('ignores a supply whose type says it is not a battery', async () => {
		pretendPlatform('linux');
		const root = await withRoot({
			BAT0: { capacity: '55', status: 'Discharging', type: 'Mains' },
		});
		await expect(readLinuxBattery(root)).resolves.toBeNull();
	});

	// A docked machine reporting `status=Unknown` is the case that used to read
	// as draining at 100%, releasing the power-save blocker on a plugged-in host.
	test('treats an Unknown status as on AC when a mains supply is online', async () => {
		pretendPlatform('linux');
		const root = await withRoot({
			AC: { online: '1', type: 'Mains' },
			BAT0: { capacity: '100', status: 'Unknown', type: 'Battery' },
		});
		await expect(readLinuxBattery(root)).resolves.toEqual({
			charging: true,
			percent: 100,
		});
	});

	test('treats an Unknown status as discharging when mains is offline', async () => {
		pretendPlatform('linux');
		const root = await withRoot({
			AC: { online: '0', type: 'Mains' },
			BAT0: { capacity: '48', status: 'Unknown', type: 'Battery' },
		});
		await expect(readLinuxBattery(root)).resolves.toEqual({
			charging: false,
			percent: 48,
		});
	});

	test('treats an Unknown status as discharging when there is no mains supply', async () => {
		pretendPlatform('linux');
		const root = await withRoot({
			BAT0: { capacity: '48', status: 'Unknown', type: 'Battery' },
		});
		await expect(readLinuxBattery(root)).resolves.toEqual({
			charging: false,
			percent: 48,
		});
	});

	test('falls back to the mains supply when the status attribute is missing', async () => {
		pretendPlatform('linux');
		const root = await withRoot({
			ADP1: { online: '1', type: 'Mains' },
			BAT0: { capacity: '90', type: 'Battery' },
		});
		await expect(readLinuxBattery(root)).resolves.toEqual({
			charging: true,
			percent: 90,
		});
	});

	test('returns null for a desktop with no battery', async () => {
		pretendPlatform('linux');
		const root = await withRoot({ AC: { online: '1' } });
		await expect(readLinuxBattery(root)).resolves.toBeNull();
	});

	test('returns null when the power-supply root does not exist', async () => {
		pretendPlatform('linux');
		await expect(
			readLinuxBattery('/nonexistent/ensemblr/power_supply'),
		).resolves.toBeNull();
	});

	test('returns null off Linux without touching the filesystem', async () => {
		pretendPlatform('darwin');
		const root = await withRoot({
			BAT0: { capacity: '87', status: 'Discharging' },
		});
		await expect(readLinuxBattery(root)).resolves.toBeNull();
	});
});
