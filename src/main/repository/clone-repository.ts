import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	statSync,
} from 'node:fs';
import path from 'node:path';

import type {
	CloneGithubRepositoryDiagnostic,
	CloneGithubRepositoryDiagnosticCode,
	CloneGithubRepositoryPreparation,
	CloneGithubRepositoryPrepareResult,
	CloneGithubRepositoryProgressEvent,
	CloneGithubRepositoryProgressKind,
	CloneGithubRepositoryRequest,
	CloneGithubRepositoryStartRequest,
	CloneGithubRepositoryStartResult,
	RegisteredRepositorySnapshot,
} from '../../shared/ipc';
import type { EnsembleRootDirectoryService } from '../root';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import {
	isRemoteUrlTracked,
	type LocalRepositoryRegistrationService,
} from './register-repository.ts';
import { allocateUniqueTargetPath } from './target-path.ts';

/** Streamed update sent back while a clone job runs. */
export type CloneProgressListener = (
	event: CloneGithubRepositoryProgressEvent,
) => void;

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

/** Test seam: invoked once per spawn attempt (`gh` then `git` on fallback). */
export type CloneCommandRunner = (
	request: CloneCommandRunRequest,
	handlers: CloneCommandRunHandlers,
) => Promise<CloneCommandRunResult>;

/** Inputs handed to a {@link CloneCommandRunner}. */
export interface CloneCommandRunRequest {
	args: string[];
	command: 'gh' | 'git';
	cwd: string;
}

/** Stream callbacks the runner uses to surface output line-by-line. */
export interface CloneCommandRunHandlers {
	onStderr: (text: string) => void;
	onStdout: (text: string) => void;
}

/** Outcome of a single runner invocation. */
export interface CloneCommandRunResult {
	exitCode: number | null;
	failure?: 'command-not-found' | 'spawn-error';
	failureMessage?: string;
	signal: NodeJS.Signals | string | null;
}

/** Construction options for {@link createGithubCloneService}. */
export interface CreateGithubCloneServiceOptions {
	commandRunner?: CloneCommandRunner;
	databaseService: EnsembleDatabaseService;
	now?: () => Date;
	registrationService: LocalRepositoryRegistrationService;
	rootDirectoryService: EnsembleRootDirectoryService;
}

const GITHUB_URL_PATTERN =
	/^https?:\/\/(?:[^/@\s]*@)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;
const SSH_URL_PATTERN = /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i;
const SHORTHAND_URL_PATTERN = /^(?:gh:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i;
const CLONE_PROGRESS_GIT_ARGS = ['--progress'];
const PREPARED_JOB_TTL_MS = 5 * 60 * 1000;

/** Internal: a prepared-but-not-yet-started clone job. */
interface PreparedJob {
	createdAtMs: number;
	preparation: CloneGithubRepositoryPreparation;
}

/**
 * Builds the GitHub clone service used by the IPC layer. Validates URLs and
 * destinations, streams `gh`/`git` output to the renderer, registers the
 * resulting repository on success, and classifies failures into actionable
 * diagnostics.
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
	const preparedJobs = new Map<string, PreparedJob>();

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
		evictExpiredJobs(preparedJobs, now);

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
		preparedJobs.set(preparation.jobId, {
			createdAtMs: now().getTime(),
			preparation,
		});

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
		evictExpiredJobs(preparedJobs, now);

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

		const ghAttempt = await runAttempt({
			command: 'gh',
			args: [
				'repo',
				'clone',
				preparation.validatedUrl,
				preparation.targetPath,
				'--',
				...CLONE_PROGRESS_GIT_ARGS,
			],
			cwd: parentPath,
			emit,
			runner: commandRunner,
		});

		let finalAttempt = ghAttempt;
		if (ghAttempt.failure === 'command-not-found') {
			emit('status', 'GitHub CLI not found; falling back to git…');
			finalAttempt = await runAttempt({
				command: 'git',
				args: [
					'clone',
					...CLONE_PROGRESS_GIT_ARGS,
					preparation.sanitizedUrl,
					preparation.targetPath,
				],
				cwd: parentPath,
				emit,
				runner: commandRunner,
			});

			if (finalAttempt.failure === 'command-not-found') {
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
		}

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

/** Parsed components of an accepted GitHub URL. */
interface ParsedGithubUrl {
	repositoryName: string;
	sanitizedUrl: string;
	validatedUrl: string;
}

/**
 * Recognises the GitHub URL forms Ensemble accepts and returns the canonical
 * `https://github.com/owner/repo.git` form plus the bare `owner/repo` slug
 * passed to `gh repo clone`. Returns `null` for any other input.
 */
function parseGithubUrl(url: unknown): ParsedGithubUrl | null {
	if (typeof url !== 'string') {
		return null;
	}
	const trimmed = url.trim();
	if (!trimmed) {
		return null;
	}

	const httpsMatch = trimmed.match(GITHUB_URL_PATTERN);
	const sshMatch = !httpsMatch ? trimmed.match(SSH_URL_PATTERN) : null;
	const shortMatch =
		!httpsMatch && !sshMatch ? trimmed.match(SHORTHAND_URL_PATTERN) : null;

	const match = httpsMatch ?? sshMatch ?? shortMatch;
	if (!match) {
		return null;
	}

	const owner = match[1];
	const repoNameRaw = match[2];
	if (!owner || !repoNameRaw) {
		return null;
	}
	const repositoryName = repoNameRaw.replace(/\.git$/i, '');
	if (!repositoryName) {
		return null;
	}

	return {
		repositoryName,
		sanitizedUrl: `https://github.com/${owner}/${repositoryName}.git`,
		validatedUrl: `${owner}/${repositoryName}`,
	};
}

/** Inputs for {@link resolveDestination}. */
interface ResolveDestinationOptions {
	defaultParentPath: string;
	destinationPath: string | undefined;
	repositoryName: string;
}

/** Result of {@link resolveDestination}. */
interface ResolveDestinationResult {
	diagnostic?: CloneGithubRepositoryDiagnostic;
	targetPath: string;
}

/**
 * Picks the absolute destination directory the clone will be written to,
 * combining the optional caller override with the managed repos path.
 */
function resolveDestination({
	defaultParentPath,
	destinationPath,
	repositoryName,
}: ResolveDestinationOptions): ResolveDestinationResult {
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

/**
 * Confirms the parent directory of the resolved target will accept new writes.
 * Existence collisions on the leaf are handled upstream by
 * {@link allocateUniqueTargetPath} so they never bubble up as failures here.
 */
function assertTargetWritable(
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
			message: `Ensemble cannot write into ${parent}. Pick a writable location.`,
			path: parent,
			severity: 'error',
		};
	}
}

/**
 * Ensures the parent directory exists before spawning the clone, surfacing a
 * diagnostic when creation fails.
 */
function ensureParentDirectory(parentPath: string): {
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

/** Internal helper that runs a single clone attempt and captures stderr text. */
async function runAttempt({
	args,
	command,
	cwd,
	emit,
	runner,
}: {
	args: string[];
	command: 'gh' | 'git';
	cwd: string;
	emit: ReturnType<typeof createEmitter>;
	runner: CloneCommandRunner;
}): Promise<CloneCommandRunResult & { stderrText: string }> {
	emit('status', `Running ${formatCommandLine(command, args)}`);

	let stderrText = '';
	const result = await runner(
		{ args, command, cwd },
		{
			onStderr: (text) => {
				stderrText += text;
				for (const line of splitLines(text)) {
					emit('stderr', line);
				}
			},
			onStdout: (text) => {
				for (const line of splitLines(text)) {
					emit('stdout', line);
				}
			},
		},
	);

	return { ...result, stderrText };
}

/** Splits an incoming chunk into one-line records, dropping the final newline. */
function splitLines(text: string): string[] {
	if (!text) {
		return [];
	}
	return text
		.replace(/\r\n/g, '\n')
		.split(/[\n\r]/)
		.filter((line) => line.length > 0);
}

/** Joins a command and its args into a printable single-line label. */
function formatCommandLine(command: string, args: readonly string[]): string {
	return [command, ...args].join(' ');
}

/**
 * Maps the captured stderr from a failed clone into a categorised diagnostic.
 */
function classifyCloneFailure({
	exitCode,
	stderr,
	targetPath,
}: {
	exitCode: number | null;
	stderr: string;
	targetPath: string;
}): CloneGithubRepositoryDiagnostic {
	const lower = stderr.toLowerCase();

	if (
		lower.includes('authentication failed') ||
		lower.includes('could not read username') ||
		lower.includes('permission denied (publickey)') ||
		lower.includes('gh auth login') ||
		lower.includes('401')
	) {
		return {
			code: 'auth',
			message:
				'GitHub authentication failed. Run gh auth login --hostname github.com or update your SSH credentials, then retry.',
			severity: 'error',
		};
	}

	if (
		lower.includes('repository not found') ||
		lower.includes('404') ||
		lower.includes('not found')
	) {
		return {
			code: 'repository-not-found',
			message:
				'GitHub could not find this repository. Check the URL and that your account has access.',
			severity: 'error',
		};
	}

	if (
		lower.includes('could not resolve host') ||
		lower.includes('failed to connect') ||
		lower.includes('network is unreachable') ||
		lower.includes('timed out') ||
		lower.includes('connection refused')
	) {
		return {
			code: 'network',
			message:
				'GitHub is unreachable. Check your network connection and retry.',
			severity: 'error',
		};
	}

	if (lower.includes('already exists') && lower.includes('destination path')) {
		return {
			code: 'destination-exists',
			message: `A directory already exists at ${targetPath}. Remove it or pick a different location.`,
			path: targetPath,
			severity: 'error',
		};
	}

	if (lower.includes('permission denied')) {
		return {
			code: 'permission',
			message: `Permission denied when writing to ${targetPath}.`,
			path: targetPath,
			severity: 'error',
		};
	}

	return {
		code: 'git-failed',
		message: `Clone failed${exitCode !== null ? ` with exit code ${exitCode}` : ''}.`,
		severity: 'error',
	};
}

/** Build the standardised failure result used by {@link GithubCloneService.start}. */
function failureResult({
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

/**
 * Creates the `emit(kind, text)` helper used by start; pushes events onto the
 * captured log buffer and forwards them to the optional progress listener.
 */
function createEmitter({
	jobId,
	logs,
	now,
	onProgress,
}: {
	jobId: string;
	logs: CloneGithubRepositoryProgressEvent[];
	now: () => Date;
	onProgress?: CloneProgressListener;
}): (kind: CloneGithubRepositoryProgressKind, text: string) => void {
	return (kind, text) => {
		const event: CloneGithubRepositoryProgressEvent = {
			jobId,
			kind,
			text,
			timestamp: now().toISOString(),
		};
		logs.push(event);
		onProgress?.(event);
	};
}

/** Drops prepared jobs whose TTL has elapsed; keeps the map size bounded. */
function evictExpiredJobs(
	preparedJobs: Map<string, PreparedJob>,
	now: () => Date,
): void {
	const nowMs = now().getTime();
	for (const [id, job] of preparedJobs) {
		if (nowMs - job.createdAtMs > PREPARED_JOB_TTL_MS) {
			preparedJobs.delete(id);
		}
	}
}

/**
 * Default {@link CloneCommandRunner}: spawns `command` and forwards
 * line-buffered stdout/stderr through the handlers.
 */
function runCloneCommand(
	{ args, command, cwd }: CloneCommandRunRequest,
	{ onStderr, onStdout }: CloneCommandRunHandlers,
): Promise<CloneCommandRunResult> {
	return new Promise((resolve) => {
		const child = nodeSpawn(command, args, {
			cwd,
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		child.stdout?.setEncoding('utf8');
		child.stderr?.setEncoding('utf8');

		child.stdout?.on('data', (chunk: string) => {
			onStdout(chunk);
		});
		child.stderr?.on('data', (chunk: string) => {
			onStderr(chunk);
		});

		child.once('error', (error) => {
			const code = (error as NodeJS.ErrnoException).code;
			resolve({
				exitCode: null,
				failure: code === 'ENOENT' ? 'command-not-found' : 'spawn-error',
				failureMessage: error.message,
				signal: null,
			});
		});

		child.once('close', (exitCode, signal) => {
			resolve({
				exitCode,
				signal,
			});
		});
	});
}
