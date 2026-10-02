import { statSync } from 'node:fs';
import path from 'node:path';

import { createFailure } from './command-result.ts';
import type {
	LocalCommandFailure,
	LocalCommandRequest,
} from './command-types.ts';

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

/**
 * Validates and defaults a {@link LocalCommandRequest}, surfacing the first
 * shape problem as an `invalid-input` failure instead of throwing.
 * @param request - Raw caller-provided request.
 * @returns Normalised fields plus an optional failure when input is invalid.
 */
export function normalizeLocalCommandRequest(request: LocalCommandRequest): {
	args: string[];
	command: string;
	cwd?: string;
	env: Record<string, string | null | undefined>;
	failure?: LocalCommandFailure;
	maxOutputBytes: number;
	redactValues: readonly string[];
	timeoutMs?: number;
} {
	const command =
		typeof request.command === 'string' ? request.command.trim() : '';
	const args = Array.isArray(request.args) ? Array.from(request.args) : [];
	const env = request.env ?? {};
	const redactValues = request.redactValues ?? [];
	const maxOutputBytes = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

	if (!command) {
		return {
			args,
			command,
			env,
			failure: createFailure(
				'invalid-input',
				'Command must be a non-empty string.',
				null,
				null,
			),
			maxOutputBytes,
			redactValues,
		};
	}

	if (command.includes('\u0000')) {
		return {
			args,
			command,
			env,
			failure: createFailure(
				'invalid-input',
				'Command must not contain NUL bytes.',
				null,
				null,
			),
			maxOutputBytes,
			redactValues,
		};
	}

	const invalidArg = args.find(
		(arg) => typeof arg !== 'string' || arg.includes('\u0000'),
	);

	if (invalidArg !== undefined) {
		return {
			args,
			command,
			env,
			failure: createFailure(
				'invalid-input',
				'Command arguments must be strings without NUL bytes.',
				null,
				null,
			),
			maxOutputBytes,
			redactValues,
		};
	}

	const invalidEnvKey = Object.keys(env).find(
		(key) => !key || key.includes('=') || key.includes('\u0000'),
	);
	const invalidEnvValue = Object.values(env).find(
		(value) => typeof value === 'string' && value.includes('\u0000'),
	);

	if (invalidEnvKey !== undefined || invalidEnvValue !== undefined) {
		return {
			args,
			command,
			env,
			failure: createFailure(
				'invalid-input',
				'Environment overrides must use valid keys and string values without NUL bytes.',
				null,
				null,
			),
			maxOutputBytes,
			redactValues,
		};
	}

	if (
		!Number.isInteger(maxOutputBytes) ||
		maxOutputBytes < 1 ||
		maxOutputBytes > Number.MAX_SAFE_INTEGER
	) {
		return {
			args,
			command,
			env,
			failure: createFailure(
				'invalid-input',
				'maxOutputBytes must be a positive integer.',
				null,
				null,
			),
			maxOutputBytes,
			redactValues,
		};
	}

	if (
		request.timeoutMs !== undefined &&
		(!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1)
	) {
		return {
			args,
			command,
			env,
			failure: createFailure(
				'invalid-input',
				'timeoutMs must be a positive integer when provided.',
				null,
				null,
			),
			maxOutputBytes,
			redactValues,
		};
	}

	return {
		args,
		command,
		cwd: request.cwd,
		env,
		maxOutputBytes,
		redactValues,
		timeoutMs: request.timeoutMs,
	};
}

/**
 * Resolves the candidate working directory and confirms it exists.
 * @param cwd - Candidate path.
 * @returns The resolved absolute path plus an optional failure.
 */
export function validateCwd(cwd: string): {
	failure?: LocalCommandFailure;
	path: string;
} {
	if (!cwd || cwd.includes('\u0000')) {
		return {
			failure: createFailure(
				'invalid-cwd',
				'Command cwd must be a valid directory path.',
				null,
				null,
			),
			path: cwd,
		};
	}

	const resolvedPath = path.resolve(cwd);

	try {
		if (!statSync(resolvedPath).isDirectory()) {
			return {
				failure: createFailure(
					'invalid-cwd',
					'Command cwd must point to an existing directory.',
					null,
					null,
				),
				path: resolvedPath,
			};
		}
	} catch {
		return {
			failure: createFailure(
				'invalid-cwd',
				'Command cwd must point to an existing directory.',
				null,
				null,
			),
			path: resolvedPath,
		};
	}

	return { path: resolvedPath };
}
