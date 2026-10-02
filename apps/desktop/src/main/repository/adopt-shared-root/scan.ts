import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import type { SharedRootAdoptionDiagnostic } from '../../../shared/ipc/contracts/shared-root-adoption';

/**
 * Lists immediate subdirectory names under `directoryPath`, surfacing
 * read errors as diagnostics so the parent scan can continue gracefully.
 */
export function readChildDirectories(
	directoryPath: string,
	diagnostics: SharedRootAdoptionDiagnostic[],
	failureCode: SharedRootAdoptionDiagnostic['code'],
): string[] {
	let entries: string[];

	try {
		entries = readdirSync(directoryPath).sort();
	} catch (error) {
		diagnostics.push({
			code: failureCode,
			message:
				error instanceof Error
					? error.message
					: 'Failed to read directory during shared-root adoption.',
			path: directoryPath,
			severity: 'warning',
		});
		return [];
	}

	const directories: string[] = [];

	for (const entry of entries) {
		if (entry.startsWith('.')) {
			continue;
		}
		const entryPath = path.join(directoryPath, entry);

		try {
			if (statSync(entryPath).isDirectory()) {
				directories.push(entry);
			}
		} catch {
			// Skip unreadable entries; the higher-level scan reports the path on later attempts.
		}
	}

	return directories;
}
