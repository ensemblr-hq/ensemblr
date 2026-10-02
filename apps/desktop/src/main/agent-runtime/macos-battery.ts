import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { stripLaunchContextEnv } from '../environment/launch-env.ts';
import type { BatterySnapshot } from './agent-activity-monitor.ts';

const execFileAsync = promisify(execFile);

/**
 * Parses `pmset -g batt` output into a battery snapshot. Returns `null` when no
 * battery is present (desktops), so callers treat "unknown" as "no limit".
 *
 * Charging detection is word-boundary-safe: the `;\s*charg` anchor matches
 * `; charging` / `; charged` but NOT `; discharging`.
 */
export function parsePmsetBattery(output: string): BatterySnapshot | null {
	const percentMatch = output.match(/(\d+)%/);
	if (!percentMatch) {
		return null;
	}
	const percent = Number(percentMatch[1]);
	if (!Number.isFinite(percent)) {
		return null;
	}
	const lower = output.toLowerCase();
	const charging =
		/\bac power\b/.test(lower) || /;\s*charg(?:ing|ed)/.test(lower);
	return { charging, percent };
}

/**
 * Reads the macOS battery via `pmset`; resolves `null` off-darwin or on any
 * failure. Async (subprocess off the main thread) so the activity monitor can
 * sample it without ever blocking Electron's event loop.
 */
export async function readMacosBattery(): Promise<BatterySnapshot | null> {
	if (process.platform !== 'darwin') {
		return null;
	}
	try {
		const { stdout } = await execFileAsync('pmset', ['-g', 'batt'], {
			encoding: 'utf8',
			env: stripLaunchContextEnv(process.env),
			timeout: 2_000,
		});
		return parsePmsetBattery(stdout);
	} catch {
		return null;
	}
}
