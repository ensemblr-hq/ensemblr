import { spawn } from 'node:child_process';
import path from 'node:path';

import type {
	CommandEnvironmentDiagnostic,
	CommandEnvironmentSnapshot,
	ShellEnvironmentLoader,
	ShellEnvironmentLoaderRequest,
	ShellEnvironmentLoaderResult,
} from './command-types.ts';

const SHELL_ENVIRONMENT_BEGIN_SENTINEL = '__ENSEMBLR_SHELL_ENV_BEGIN__';
const SHELL_ENVIRONMENT_END_SENTINEL = '__ENSEMBLR_SHELL_ENV_END__';

/**
 * Resolves the command environment by invoking the configured shell loader,
 * recording diagnostics on each failure mode and falling back to the Electron
 * process environment when the shell cannot be consulted.
 * @param input - Loader dependencies and configuration.
 * @returns The resolved environment snapshot.
 */
export async function resolveCommandEnvironment({
	baseEnv,
	commonPathEntries,
	cwd,
	environmentTimeoutMs,
	now,
	shell,
	shellEnvironmentLoader,
}: {
	baseEnv: Record<string, string>;
	commonPathEntries: readonly string[];
	cwd?: string;
	environmentTimeoutMs: number;
	now: () => Date;
	shell: string;
	shellEnvironmentLoader: ShellEnvironmentLoader;
}): Promise<CommandEnvironmentSnapshot> {
	const diagnostics: CommandEnvironmentDiagnostic[] = [];

	try {
		const result = await shellEnvironmentLoader({
			baseEnv,
			cwd,
			shell,
			timeoutMs: environmentTimeoutMs,
		});

		if (result.timedOut) {
			diagnostics.push({
				code: 'shell-env-timeout',
				message: 'Shell environment resolution timed out.',
				severity: 'warning',
			});
		} else if (result.error) {
			diagnostics.push({
				code: 'shell-env-error',
				message: 'Shell environment resolution failed to start.',
				severity: 'warning',
			});
		} else if (result.exitCode !== 0) {
			diagnostics.push({
				code: 'shell-env-exit',
				message: `Shell environment resolution exited with code ${String(result.exitCode)}.`,
				severity: 'warning',
			});
		} else {
			const parsedEnv = parseShellEnvironmentOutput(result.stdout);

			if (parsedEnv) {
				const env = ensureEnvironmentPath(parsedEnv, commonPathEntries);

				return {
					diagnostics,
					env,
					path: env.PATH ?? '',
					resolvedAt: now().toISOString(),
					shell,
					source: 'shell',
				};
			}

			diagnostics.push({
				code: 'shell-env-unparseable',
				message:
					'Shell environment resolution did not return parseable sentinel output.',
				severity: 'warning',
			});
		}
	} catch {
		diagnostics.push({
			code: 'shell-env-error',
			message: 'Shell environment resolution failed unexpectedly.',
			severity: 'warning',
		});
	}

	diagnostics.push({
		code: 'shell-env-fallback',
		message:
			'Using Electron process environment with common PATH entries as a fallback.',
		severity: 'warning',
	});

	const env = ensureEnvironmentPath(baseEnv, commonPathEntries);

	return {
		diagnostics,
		env,
		path: env.PATH ?? '',
		resolvedAt: now().toISOString(),
		shell,
		source: 'fallback',
	};
}

/**
 * Default {@link ShellEnvironmentLoader} that spawns the configured login shell
 * and prints sentinel-delimited NUL-separated environment entries to stdout.
 * @param input - Loader request.
 * @returns Captured exit metadata and stdout/stderr.
 */
export function loadShellEnvironment({
	baseEnv,
	cwd,
	shell,
	timeoutMs,
}: ShellEnvironmentLoaderRequest): Promise<ShellEnvironmentLoaderResult> {
	return new Promise((resolve) => {
		const child = spawn(
			shell,
			[
				'-lic',
				`printf '%s\\0' '${SHELL_ENVIRONMENT_BEGIN_SENTINEL}'; /usr/bin/env -0; printf '%s\\0' '${SHELL_ENVIRONMENT_END_SENTINEL}'`,
			],
			{
				cwd,
				env: baseEnv,
				shell: false,
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		);
		const stderrChunks: Buffer[] = [];
		const stdoutChunks: Buffer[] = [];
		let settled = false;
		let timedOut = false;

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGTERM');
		}, timeoutMs);

		/**
		 * Resolves the loader promise exactly once.
		 * @param result - Loader result to surface.
		 */
		function settle(result: ShellEnvironmentLoaderResult): void {
			if (settled) {
				return;
			}

			settled = true;
			clearTimeout(timer);
			resolve(result);
		}

		child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
		child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
		child.on('error', (error) => {
			settle({
				error,
				exitCode: null,
				signal: null,
				stderr: Buffer.concat(stderrChunks).toString('utf8'),
				stdout: Buffer.concat(stdoutChunks).toString('utf8'),
				timedOut,
			});
		});
		child.on('close', (exitCode, signal) => {
			settle({
				exitCode,
				signal,
				stderr: Buffer.concat(stderrChunks).toString('utf8'),
				stdout: Buffer.concat(stdoutChunks).toString('utf8'),
				timedOut,
			});
		});
	});
}

/**
 * Parses sentinel-delimited NUL-separated environment dump produced by the
 * default shell loader.
 * @param stdout - Captured shell stdout.
 * @returns A `KEY=value` map, or `null` when sentinels are missing/malformed.
 */
function parseShellEnvironmentOutput(
	stdout: string,
): Record<string, string> | null {
	const fields = stdout.split('\u0000');
	const beginIndex = fields.indexOf(SHELL_ENVIRONMENT_BEGIN_SENTINEL);

	if (beginIndex === -1) {
		return null;
	}

	const endIndex = fields.indexOf(
		SHELL_ENVIRONMENT_END_SENTINEL,
		beginIndex + 1,
	);

	if (endIndex === -1 || endIndex <= beginIndex) {
		return null;
	}

	const env: Record<string, string> = {};

	for (const field of fields.slice(beginIndex + 1, endIndex)) {
		const separatorIndex = field.indexOf('=');

		if (separatorIndex <= 0) {
			continue;
		}

		const key = field.slice(0, separatorIndex);

		if (!key || key.includes('\u0000')) {
			continue;
		}

		env[key] = field.slice(separatorIndex + 1);
	}

	return Object.keys(env).length > 0 ? env : null;
}

/**
 * Filters an environment map to entries with safe keys and string values,
 * rejecting NUL bytes and `=` in keys.
 * @param env - Environment to normalise.
 * @returns A new map containing only safe entries.
 */
export function normalizeEnvironment(
	env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, string> {
	const normalized: Record<string, string> = {};

	for (const [key, value] of Object.entries(env)) {
		if (
			key &&
			!key.includes('=') &&
			!key.includes('\u0000') &&
			typeof value === 'string' &&
			!value.includes('\u0000')
		) {
			normalized[key] = value;
		}
	}

	return normalized;
}

/**
 * Returns a clone of `env` with its `PATH` augmented by the common path entries.
 * @param env - Base environment.
 * @param commonPathEntries - Entries to append to `PATH` when missing.
 * @returns The augmented environment.
 */
function ensureEnvironmentPath(
	env: Record<string, string>,
	commonPathEntries: readonly string[],
): Record<string, string> {
	return {
		...env,
		PATH: mergePath(env.PATH, commonPathEntries),
	};
}

/**
 * Applies caller overrides onto a base environment; `null`/`undefined` entries
 * delete the matching key.
 * @param env - Base environment.
 * @param overrides - Caller-supplied overrides.
 * @returns A new environment with overrides applied.
 */
export function mergeEnvironment(
	env: Record<string, string>,
	overrides: Record<string, string | null | undefined>,
): Record<string, string> {
	const merged = { ...env };

	for (const [key, value] of Object.entries(overrides)) {
		if (value === null || value === undefined) {
			delete merged[key];
			continue;
		}

		merged[key] = value;
	}

	return merged;
}

/**
 * Merges a `PATH` string with extra entries while preserving order and
 * deduplicating.
 * @param pathValue - Existing PATH value, possibly undefined.
 * @param commonPathEntries - Entries to append when not already present.
 * @returns The combined PATH string.
 */
function mergePath(
	pathValue: string | undefined,
	commonPathEntries: readonly string[],
): string {
	const entries = (pathValue ?? '').split(path.delimiter).flatMap((entry) => {
		const trimmed = entry.trim();
		return trimmed ? [trimmed] : [];
	});
	const seen = new Set(entries);

	for (const entry of commonPathEntries) {
		if (!seen.has(entry)) {
			entries.push(entry);
			seen.add(entry);
		}
	}

	return entries.join(path.delimiter);
}

/**
 * Picks the login shell to consult, preferring `$SHELL` and falling back to
 * platform defaults.
 * @param baseEnv - Process environment to inspect.
 * @returns Absolute path to the shell.
 */
export function resolveDefaultShell(baseEnv: Record<string, string>): string {
	if (baseEnv.SHELL) {
		return baseEnv.SHELL;
	}

	if (process.platform === 'darwin') {
		return '/bin/zsh';
	}

	return '/bin/sh';
}

/**
 * Returns the platform-appropriate PATH entries appended to the shell PATH.
 * @returns A readonly array of directory paths.
 */
export function getDefaultCommonPathEntries(): readonly string[] {
	if (process.platform === 'darwin') {
		return [
			'/opt/homebrew/bin',
			'/usr/local/bin',
			'/usr/bin',
			'/bin',
			'/usr/sbin',
			'/sbin',
		];
	}

	return ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
}

/**
 * Returns a deep clone of an environment snapshot so callers can mutate it safely.
 * @param snapshot - Snapshot to clone.
 * @returns A new snapshot whose nested collections are fresh copies.
 */
export function cloneEnvironmentSnapshot(
	snapshot: CommandEnvironmentSnapshot,
): CommandEnvironmentSnapshot {
	return {
		...snapshot,
		diagnostics: snapshot.diagnostics.map((diagnostic) => ({ ...diagnostic })),
		env: { ...snapshot.env },
	};
}
