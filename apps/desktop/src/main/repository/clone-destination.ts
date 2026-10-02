import path from 'node:path';

import type {
	CloneGithubRepositoryDiagnostic,
	CloneGithubRepositoryProgressEvent,
	CloneGithubRepositoryStartResult,
} from '../../shared/ipc/contracts/clone';
import type { RegisteredRepositorySnapshot } from '../../shared/ipc/contracts/repository';
import { allocateUniqueTargetPath } from './target-path.ts';

/** Result of {@link resolveDestination}. */
interface ResolveDestinationResult {
	diagnostic?: CloneGithubRepositoryDiagnostic;
	targetPath: string;
}

/**
 * Picks the absolute destination directory the clone will be written to,
 * combining the optional caller override with the managed repos path.
 */
export function resolveDestination({
	defaultParentPath,
	destinationPath,
	repositoryName,
}: {
	defaultParentPath: string;
	destinationPath: string | undefined;
	repositoryName: string;
}): ResolveDestinationResult {
	const overrideRaw =
		typeof destinationPath === 'string' ? destinationPath.trim() : '';

	if (overrideRaw) {
		if (!path.isAbsolute(overrideRaw)) {
			return {
				diagnostic: {
					code: 'destination-path-relative',
					message: 'The destination path must be absolute.',
					path: overrideRaw,
					severity: 'error',
				},
				targetPath: overrideRaw,
			};
		}
		const resolved = path.resolve(overrideRaw);
		return {
			targetPath: allocateUniqueTargetPath(
				path.dirname(resolved),
				path.basename(resolved),
			),
		};
	}

	if (!defaultParentPath) {
		return {
			diagnostic: {
				code: 'destination-required',
				message:
					'No destination directory was provided and the managed root has no repos path.',
				severity: 'error',
			},
			targetPath: '',
		};
	}

	return {
		targetPath: allocateUniqueTargetPath(defaultParentPath, repositoryName),
	};
}

/** Build the standardised failure result used by `GithubCloneService.start`. */
export function failureResult({
	diagnostic,
	jobId,
	logs,
	repository,
	targetPath,
}: {
	diagnostic: CloneGithubRepositoryDiagnostic;
	jobId: string;
	logs: CloneGithubRepositoryProgressEvent[];
	repository?: RegisteredRepositorySnapshot | null;
	targetPath: string;
}): CloneGithubRepositoryStartResult {
	return {
		diagnostics: [diagnostic],
		jobId,
		logs,
		repository: repository ?? null,
		status: 'failure',
		targetPath,
	};
}
