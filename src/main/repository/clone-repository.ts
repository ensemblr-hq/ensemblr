import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type {
	CloneGithubRepositoryDiagnostic,
	CloneGithubRepositoryDiagnosticCode,
	CloneGithubRepositoryPreparation,
	CloneGithubRepositoryPrepareResult,
	CloneGithubRepositoryProgressEvent,
	CloneGithubRepositoryRequest,
	CloneGithubRepositoryStartRequest,
	CloneGithubRepositoryStartResult,
} from '../../shared/ipc/contracts/clone';
import type { EnsembleRootDirectoryService } from '../root';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import { classifyCloneFailure } from './clone-classifier.ts';
import { failureResult, resolveDestination } from './clone-destination.ts';
import { assertTargetWritable, ensureParentDirectory } from './clone-fs.ts';
import { createPreparedJobStore } from './clone-jobs.ts';
import {
	type CloneCommandRunner,
	type CloneProgressListener,
	createEmitter,
	runCloneCommand,
	runCloneWithFallback,
} from './clone-runner.ts';
import { parseGithubUrl } from './github-url.ts';
import {
	isRemoteUrlTracked,
	type LocalRepositoryRegistrationService,
} from './register-repository.ts';

export type {
	CloneCommandRunHandlers,
	CloneCommandRunner,
	CloneCommandRunRequest,
	CloneCommandRunResult,
	CloneProgressListener,
} from './clone-runner.ts';

/** Per-call options for {@link GithubCloneService.start}. */
export interface GithubCloneStartOptions {
	onProgress?: CloneProgressListener;
}

/** Public surface of the GitHub clone service. */
export interface GithubCloneService {
	prepare: (
		request: CloneGithubRepositoryRequest,
	) => Promise<CloneGithubRepositoryPrepareResult>;
	start: (
		request: CloneGithubRepositoryStartRequest,
		options?: GithubCloneStartOptions,
	) => Promise<CloneGithubRepositoryStartResult>;
}

/** Construction options for {@link createGithubCloneService}. */
export interface CreateGithubCloneServiceOptions {
	commandRunner?: CloneCommandRunner;
	databaseService: EnsembleDatabaseService;
	now?: () => Date;
	registrationService: LocalRepositoryRegistrationService;
	rootDirectoryService: EnsembleRootDirectoryService;
}

/**
 * Builds the GitHub clone service used by the IPC layer. Validates URLs and
 * destinations, streams `gh`/`git` output to the renderer, registers the
 * resulting repository on success, and classifies failures into actionable
 * diagnostics.
 *
 * @param options - Service dependencies and test seams.
 * @returns A {@link GithubCloneService} instance.
 */
export function createGithubCloneService({
	commandRunner = runCloneCommand,
	databaseService,
	now = () => new Date(),
	registrationService,
	rootDirectoryService,
}: CreateGithubCloneServiceOptions): GithubCloneService {
	const preparedJobs = createPreparedJobStore(now);

	return {
		prepare: async (request) => prepareClone(request),
		start: async (request, options) => startClone(request, options ?? {}),
	};

	/**
	 * Validates a clone request, allocates a jobId, and stores the resulting
	 * preparation for {@link startClone} to consume.
	 */
	async function prepareClone(
		request: CloneGithubRepositoryRequest,
	): Promise<CloneGithubRepositoryPrepareResult> {
		const diagnostics: CloneGithubRepositoryDiagnostic[] = [];
		preparedJobs.evictExpired();

		const parsedUrl = parseGithubUrl(request.url);
		if (!parsedUrl) {
			const code: CloneGithubRepositoryDiagnosticCode =
				typeof request.url === 'string' && request.url.trim().length > 0
					? 'url-invalid'
					: 'url-required';
			diagnostics.push({
				code,
				message:
					code === 'url-required'
						? 'A GitHub repository URL is required.'
						: 'Enter a GitHub URL such as https://github.com/owner/repo or git@github.com:owner/repo.',
				severity: 'error',
			});
			return { diagnostics, ok: false };
		}

		const database = databaseService.getConnection()?.database;
		if (database && isRemoteUrlTracked(database, parsedUrl.sanitizedUrl)) {
			diagnostics.push({
				code: 'remote-already-registered',
				message:
					'This repository is already registered with Ensemble. Remove it first or open the existing project.',
				severity: 'error',
			});
			return { diagnostics, ok: false };
		}

		const rootSnapshot =
			rootDirectoryService.getSnapshot() ?? rootDirectoryService.ensure();
		const defaultParentPath = rootSnapshot.repositoriesPath;
		const destination = resolveDestination({
			defaultParentPath,
			destinationPath: request.destinationPath,
			repositoryName: parsedUrl.repositoryName,
		});

		if (destination.diagnostic) {
			diagnostics.push(destination.diagnostic);
			return { diagnostics, ok: false };
		}

		const existsDiagnostic = assertTargetWritable(destination.targetPath);
		if (existsDiagnostic) {
			diagnostics.push(existsDiagnostic);
			return { diagnostics, ok: false };
		}

		const preparation: CloneGithubRepositoryPreparation = {
			defaultParentPath,
			jobId: `clone-${randomUUID()}`,
			repositoryName: parsedUrl.repositoryName,
			sanitizedUrl: parsedUrl.sanitizedUrl,
			targetPath: destination.targetPath,
			validatedUrl: parsedUrl.validatedUrl,
		};
		preparedJobs.set(preparation.jobId, preparation);

		return { diagnostics, ok: true, preparation };
	}

	/**
	 * Spawns `gh` (preferred) or `git` to clone the prepared repository, streams
	 * progress, classifies failures, and registers the repository on success.
	 */
	async function startClone(
		request: CloneGithubRepositoryStartRequest,
		{ onProgress }: GithubCloneStartOptions,
	): Promise<CloneGithubRepositoryStartResult> {
		preparedJobs.evictExpired();

		const job = preparedJobs.get(request.jobId);
		if (!job) {
			return {
				diagnostics: [
					{
						code: 'job-unknown',
						message:
							'The clone job has expired or was never prepared. Start a new clone request.',
						severity: 'error',
					},
				],
				jobId: request.jobId,
				logs: [],
				repository: null,
				status: 'failure',
				targetPath: '',
			};
		}
		preparedJobs.delete(request.jobId);

		const { preparation } = job;
		const logs: CloneGithubRepositoryProgressEvent[] = [];
		const emit = createEmitter({
			jobId: preparation.jobId,
			logs,
			now,
			onProgress,
		});

		const parentPath = path.dirname(preparation.targetPath);
		const parentReady = ensureParentDirectory(parentPath);
		if (parentReady.diagnostic) {
			emit('status', parentReady.diagnostic.message);
			return failureResult({
				diagnostic: parentReady.diagnostic,
				jobId: preparation.jobId,
				logs,
				targetPath: preparation.targetPath,
			});
		}

		emit(
			'status',
			`Cloning ${preparation.sanitizedUrl} into ${preparation.targetPath}…`,
		);

		const outcome = await runCloneWithFallback({
			cwd: parentPath,
			emit,
			preparation,
			runner: commandRunner,
		});

		if (outcome.kind === 'both-missing') {
			const diagnostic: CloneGithubRepositoryDiagnostic = {
				code: 'git-not-installed',
				message:
					'Neither gh nor git was found in PATH. Install GitHub CLI or git, then retry.',
				severity: 'error',
			};
			emit('status', diagnostic.message);
			return failureResult({
				diagnostic,
				jobId: preparation.jobId,
				logs,
				targetPath: preparation.targetPath,
			});
		}

		const finalAttempt = outcome.result;

		if (finalAttempt.failure === 'spawn-error') {
			const diagnostic: CloneGithubRepositoryDiagnostic = {
				code: 'spawn-error',
				message:
					finalAttempt.failureMessage ?? 'The clone command failed to start.',
				severity: 'error',
			};
			emit('status', diagnostic.message);
			return failureResult({
				diagnostic,
				jobId: preparation.jobId,
				logs,
				targetPath: preparation.targetPath,
			});
		}

		if (finalAttempt.exitCode !== 0) {
			const diagnostic = classifyCloneFailure({
				exitCode: finalAttempt.exitCode,
				stderr: finalAttempt.stderrText,
				targetPath: preparation.targetPath,
			});
			emit('status', diagnostic.message);
			return failureResult({
				diagnostic,
				jobId: preparation.jobId,
				logs,
				targetPath: preparation.targetPath,
			});
		}

		emit('status', 'Clone succeeded; registering repository…');

		const registration = await registrationService.register({
			name: preparation.repositoryName,
			path: preparation.targetPath,
		});

		if (!registration.registered || !registration.repository) {
			const reason =
				registration.diagnostics.find(
					(diagnostic) => diagnostic.severity === 'error',
				)?.message ?? 'The cloned repository could not be registered.';
			const diagnostic: CloneGithubRepositoryDiagnostic = {
				code: 'register-failed',
				message: reason,
				path: preparation.targetPath,
				severity: 'error',
			};
			emit('status', diagnostic.message);
			return failureResult({
				diagnostic,
				jobId: preparation.jobId,
				logs,
				repository: null,
				targetPath: preparation.targetPath,
			});
		}

		emit(
			'status',
			`Registered ${registration.repository.name} (${registration.repository.path}).`,
		);

		return {
			diagnostics: [],
			jobId: preparation.jobId,
			logs,
			repository: registration.repository,
			status: 'success',
			targetPath: preparation.targetPath,
		};
	}
}
