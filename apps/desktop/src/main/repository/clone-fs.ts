import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	statSync,
} from 'node:fs';
import path from 'node:path';

import type { CloneGithubRepositoryDiagnostic } from '../../shared/ipc/contracts/clone';

/**
 * Confirms the parent directory of the resolved target will accept new writes.
 * Existence collisions on the leaf are handled upstream by `allocateUniqueTargetPath`
 * so they never bubble up as failures here.
 */
export function assertTargetWritable(
	targetPath: string,
): CloneGithubRepositoryDiagnostic | null {
	const parent = path.dirname(targetPath);
	try {
		accessSync(parent, constants.W_OK);
		return null;
	} catch {
		if (!existsSync(parent)) {
			return null;
		}
		return {
			code: 'destination-not-writable',
			message: `Ensemblr cannot write into ${parent}. Pick a writable location.`,
			path: parent,
			severity: 'error',
		};
	}
}

/**
 * Ensures the parent directory exists before spawning the clone, surfacing a
 * diagnostic when creation fails.
 */
export function ensureParentDirectory(parentPath: string): {
	diagnostic?: CloneGithubRepositoryDiagnostic;
} {
	try {
		if (existsSync(parentPath)) {
			if (!statSync(parentPath).isDirectory()) {
				return {
					diagnostic: {
						code: 'destination-not-writable',
						message: `${parentPath} is not a directory.`,
						path: parentPath,
						severity: 'error',
					},
				};
			}
			return {};
		}
		mkdirSync(parentPath, { recursive: true });
		return {};
	} catch (error) {
		return {
			diagnostic: {
				code: 'destination-not-writable',
				message:
					error instanceof Error
						? error.message
						: `Failed to create the destination parent ${parentPath}.`,
				path: parentPath,
				severity: 'error',
			},
		};
	}
}
