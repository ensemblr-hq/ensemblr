import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { BatterySnapshot } from './agent-activity-monitor.ts';

const POWER_SUPPLY_ROOT = '/sys/class/power_supply';

/**
 * `status` values the kernel reports for a supply that is not draining. A
 * `Full` battery on a docked laptop never reports `Charging`, so treating only
 * `Charging` as "on AC" would release the power-save blocker on a plugged-in
 * machine.
 */
const NON_DISCHARGING_STATUSES = new Set(['charging', 'full', 'not charging']);

/**
 * Reads the battery through sysfs, which every Linux kernel exposes — no
 * `upower` daemon, no D-Bus round trip, and nothing to install on an immutable
 * distro. Resolves `null` off-Linux, on a machine with no battery, or on any
 * read failure, so callers treat "unknown" as "no limit".
 * @param root - Power-supply directory to read (overridable for tests).
 * @returns The battery snapshot, or `null` when none can be read.
 */
export async function readLinuxBattery(
	root: string = POWER_SUPPLY_ROOT,
): Promise<BatterySnapshot | null> {
	if (process.platform !== 'linux') {
		return null;
	}

	try {
		const entries = await readdir(root);
		const batteries = entries.filter((entry) => entry.startsWith('BAT')).sort();

		for (const battery of batteries) {
			const snapshot = await readBatterySnapshot(path.join(root, battery));
			if (snapshot) {
				return snapshot;
			}
		}
	} catch {
		return null;
	}

	return null;
}

/**
 * Reads one power-supply directory into a snapshot.
 * @param directory - Absolute path to a `BAT*` power-supply directory.
 * @returns The snapshot, or `null` when the capacity is missing or unparseable.
 */
async function readBatterySnapshot(
	directory: string,
): Promise<BatterySnapshot | null> {
	const percent = parsePercent(
		await readSysfsValue(path.join(directory, 'capacity')),
	);

	if (percent === null) {
		return null;
	}

	const status = (
		await readSysfsValue(path.join(directory, 'status'))
	)?.toLowerCase();

	return {
		charging: status ? NON_DISCHARGING_STATUSES.has(status) : false,
		percent,
	};
}

/**
 * Reads a sysfs attribute, trimming the trailing newline the kernel appends.
 * @param filePath - Absolute path to the attribute file.
 * @returns The trimmed value, or `null` when it cannot be read.
 */
async function readSysfsValue(filePath: string): Promise<string | null> {
	try {
		return (await readFile(filePath, 'utf8')).trim();
	} catch {
		return null;
	}
}

/**
 * Parses a sysfs `capacity` value into a percentage clamped to 0–100.
 * @param value - Raw attribute contents.
 * @returns The percentage, or `null` when the value is absent or non-numeric.
 */
function parsePercent(value: string | null): number | null {
	if (value === null) {
		return null;
	}

	const percent = Number(value);

	if (!Number.isFinite(percent)) {
		return null;
	}

	return Math.min(100, Math.max(0, Math.round(percent)));
}
