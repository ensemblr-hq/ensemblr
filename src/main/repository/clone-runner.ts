import { spawn as nodeSpawn } from 'node:child_process';

import type { CloneGithubRepositoryPreparation, CloneGithubRepositoryProgressEvent, CloneGithubRepositoryProgressKind } from '../../shared/ipc/contracts/clone';

const CLONE_PROGRESS_GIT_ARGS = ['--progress'];

/** Streamed update sent back while a clone job runs. */
export type CloneProgressListener = (
	event: CloneGithubRepositoryProgressEvent,
) => void;

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

/** Signature of the emitter returned by {@link createEmitter}. */
export type CloneEmitter = (
	kind: CloneGithubRepositoryProgressKind,
	text: string,
) => void;

/**
 * Creates the `emit(kind, text)` helper used by start: pushes events onto the
 * captured log buffer and forwards them to the optional progress listener.
 */
export function createEmitter({
	jobId,
	logs,
	now,
	onProgress,
}: {
	jobId: string;
	logs: CloneGithubRepositoryProgressEvent[];
	now: () => Date;
	onProgress?: CloneProgressListener;
}): CloneEmitter {
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

/** Internal helper that runs a single clone attempt and captures stderr text. */
export async function runAttempt({
	args,
	command,
	cwd,
	emit,
	runner,
}: {
	args: string[];
	command: 'gh' | 'git';
	cwd: string;
	emit: CloneEmitter;
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

/** Outcome of {@link runCloneWithFallback}. */
export type CloneFallbackOutcome =
	| {
			kind: 'ok';
			result: CloneCommandRunResult & { stderrText: string };
	  }
	| { kind: 'both-missing' };

/**
 * Runs `gh repo clone` first; if the binary is missing, falls back to
 * `git clone`. Surfaces a `both-missing` signal when neither command is
 * available so callers can emit the appropriate diagnostic.
 */
export async function runCloneWithFallback({
	cwd,
	emit,
	preparation,
	runner,
}: {
	cwd: string;
	emit: CloneEmitter;
	preparation: CloneGithubRepositoryPreparation;
	runner: CloneCommandRunner;
}): Promise<CloneFallbackOutcome> {
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
		cwd,
		emit,
		runner,
	});

	if (ghAttempt.failure !== 'command-not-found') {
		return { kind: 'ok', result: ghAttempt };
	}

	emit('status', 'GitHub CLI not found; falling back to git…');
	const gitAttempt = await runAttempt({
		command: 'git',
		args: [
			'clone',
			...CLONE_PROGRESS_GIT_ARGS,
			preparation.sanitizedUrl,
			preparation.targetPath,
		],
		cwd,
		emit,
		runner,
	});

	if (gitAttempt.failure === 'command-not-found') {
		return { kind: 'both-missing' };
	}

	return { kind: 'ok', result: gitAttempt };
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
 * Default {@link CloneCommandRunner}: spawns `command` and forwards
 * line-buffered stdout/stderr through the handlers.
 */
export function runCloneCommand(
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
