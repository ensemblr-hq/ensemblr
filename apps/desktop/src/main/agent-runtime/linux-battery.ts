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
 * A sysfs supply with its lowercased type and scope; device-scoped supplies
 * power peripherals rather than the computer.
 */
interface PowerSupply {
	name: string;
	scope: string | null;
	type: string | null;
}

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

	let supplies: PowerSupply[];
	try {
		supplies = await readPowerSupplies(root);
	} catch {
		return null;
	}

	for (const supply of supplies.filter(isBattery)) {
		const reading = await readBatteryReading(path.join(root, supply.name));
		if (reading === null) {
			continue;
		}
		return {
			charging:
				reading.charging ?? (await isExternalPowerOnline(root, supplies)),
			percent: reading.percent,
		};
	}

	return null;
}

/**
 * Lists every power supply under the root with its declared `type`, in a stable
 * order.
 * @param root - Power-supply directory to enumerate.
 * @returns One entry per supply, sorted by directory name.
 */
async function readPowerSupplies(root: string): Promise<PowerSupply[]> {
	const names = (await readdir(root)).sort();
	return Promise.all(
		names.map(async (name) => ({
			name,
			scope:
				(await readSysfsValue(path.join(root, name, 'scope')))?.toLowerCase() ??
				null,
			type:
				(await readSysfsValue(path.join(root, name, 'type')))?.toLowerCase() ??
				null,
		})),
	);
}

/**
 * Reports whether a supply is a battery. The `type` attribute is authoritative
 * — a laptop may name its pack `CMB0` or `macsmc-battery` rather than `BAT0` —
 * and the name prefix is only the fallback for a kernel that does not expose it.
 * @param supply - The supply to classify.
 * @returns True when the supply holds charge.
 */
function isBattery(supply: PowerSupply): boolean {
	if (supply.scope === 'device') {
		return false;
	}
	return supply.type === null
		? supply.name.startsWith('BAT')
		: supply.type === 'battery';
}

/**
 * Reports whether a system supply can provide external power, including USB chargers.
 * @param supply - The supply to classify.
 * @returns True when the supply is an external power source for the computer.
 */
function isExternalPower(supply: PowerSupply): boolean {
	if (supply.scope === 'device') {
		return false;
	}
	return supply.type === null
		? supply.name.startsWith('AC')
		: supply.type === 'mains' ||
				supply.type === 'wireless' ||
				/^usb(?:_|$)/.test(supply.type);
}

/**
 * Reports whether any external power source is online, which settles a
 * battery whose own `status` says `Unknown` — common on a desktop and on ACPI
 * implementations that never populate it. Without it a docked machine reads as
 * draining at 100%.
 * @param root - Power-supply directory the supplies were read from.
 * @param supplies - Every supply under that root.
 * @returns True when a charger is online in fixed (1) or programmable (2) mode.
 */
async function isExternalPowerOnline(
	root: string,
	supplies: PowerSupply[],
): Promise<boolean> {
	const states = await Promise.all(
		supplies.flatMap((supply) =>
			isExternalPower(supply)
				? [readSysfsValue(path.join(root, supply.name, 'online'))]
				: [],
		),
	);
	return states.some((state) => state === '1' || state === '2');
}

/**
 * Reads a present system battery. `charging` is `null` rather than `false` when
 * the kernel reports `Unknown` or no status at all, so the caller can fall back
 * to the mains supply instead of assuming the machine is draining.
 * @param directory - Absolute path to a battery power-supply directory.
 * @returns The reading, or `null` when the capacity is missing or unparseable.
 */
async function readBatteryReading(
	directory: string,
): Promise<{ charging: boolean | null; percent: number } | null> {
	if ((await readSysfsValue(path.join(directory, 'present'))) === '0') {
		return null;
	}
	const percent = parsePercent(
		await readSysfsValue(path.join(directory, 'capacity')),
	);

	if (percent === null) {
		return null;
	}

	const status = (
		await readSysfsValue(path.join(directory, 'status'))
	)?.toLowerCase();

	if (!status || status === 'unknown') {
		return { charging: null, percent };
	}

	return { charging: NON_DISCHARGING_STATUSES.has(status), percent };
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
	if (value === null || value === '') {
		return null;
	}

	const percent = Number(value);

	if (!Number.isFinite(percent)) {
		return null;
	}

	return Math.min(100, Math.max(0, Math.round(percent)));
}
