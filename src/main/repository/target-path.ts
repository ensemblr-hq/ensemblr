import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Picks an unused absolute target path under `parentPath`. If `<name>`
 * already exists on disk (typical when a previously-archived
 * repository/project folder is still present), walks `<name>-2`,
 * `<name>-3`, ... until a free slot is found. Falls back to the base path
 * after 1000 attempts.
 */
export function allocateUniqueTargetPath(
	parentPath: string,
	name: string,
): string {
	const base = path.resolve(parentPath, name);
	if (!existsSync(base)) {
		return base;
	}
	for (let suffix = 2; suffix < 1000; suffix += 1) {
		const candidate = path.resolve(parentPath, `${name}-${suffix}`);
		if (!existsSync(candidate)) {
			return candidate;
		}
	}
	return base;
}
