import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { isEnvironmentVariableKey } from './environment-variable-keys.ts';

/** Result of loading an env file from disk. */
export interface LoadEnvFileResult {
	/** Parsed `KEY=value` pairs (empty when the file is missing or unreadable). */
	values: Record<string, string>;
	/** Set when the file could not be read; absent on success. */
	error?: string;
}

/**
 * Parses the textual contents of a `.env`-style file into a `KEY=value` map.
 *
 * Supports `export KEY=value`, `#` comments, blank lines, and single- or
 * double-quoted values (quotes are stripped; `\n` escapes are expanded inside
 * double quotes). Lines with invalid variable names are ignored so a malformed
 * entry never poisons the whole file.
 * @param contents - Raw file text.
 * @returns The parsed environment map (insertion order preserved).
 */
export function parseEnvFileContents(contents: string): Record<string, string> {
	const values: Record<string, string> = {};

	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();

		if (!line || line.startsWith('#')) {
			continue;
		}

		const withoutExport = line.startsWith('export ')
			? line.slice('export '.length).trim()
			: line;
		const separatorIndex = withoutExport.indexOf('=');

		if (separatorIndex <= 0) {
			continue;
		}

		const key = withoutExport.slice(0, separatorIndex).trim();

		if (!isEnvironmentVariableKey(key)) {
			continue;
		}

		values[key] = normalizeValue(
			withoutExport.slice(separatorIndex + 1).trim(),
		);
	}

	return values;
}

/**
 * Reads and parses an env file from disk, returning an empty map plus an error
 * string when the path is missing or unreadable.
 * @param filePath - Absolute path to the env file.
 * @returns The parsed values and an optional error.
 */
export function loadEnvFile(filePath: string): LoadEnvFileResult {
	const resolvedPath = expandHomePath(filePath);

	if (!existsSync(resolvedPath)) {
		return { error: `Env file not found: ${filePath}`, values: {} };
	}

	try {
		return { values: parseEnvFileContents(readFileSync(resolvedPath, 'utf8')) };
	} catch (error) {
		return {
			error:
				error instanceof Error
					? `Failed to read env file ${filePath}: ${error.message}`
					: `Failed to read env file ${filePath}.`,
			values: {},
		};
	}
}

/**
 * Expands a leading `~` (or `~/`) to the user's home directory. Other paths are
 * returned unchanged.
 * @param filePath - Raw path, possibly tilde-prefixed.
 * @returns The home-expanded path.
 */
export function expandHomePath(filePath: string): string {
	if (filePath === '~') {
		return homedir();
	}

	if (filePath.startsWith('~/')) {
		return join(homedir(), filePath.slice(2));
	}

	return filePath;
}

/**
 * Tests whether an env-file path exists on disk, expanding a leading `~` first.
 * @param filePath - Raw path, possibly tilde-prefixed.
 * @returns True when the file exists.
 */
export function envFilePathExists(filePath: string): boolean {
	return existsSync(expandHomePath(filePath));
}

/**
 * Strips matching surrounding quotes and expands escapes inside double quotes.
 * @param value - Raw value text after the `=`.
 * @returns The normalised value.
 */
function normalizeValue(value: string): string {
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
		return value
			.slice(1, -1)
			.replace(/\\n/g, '\n')
			.replace(/\\r/g, '\r')
			.replace(/\\t/g, '\t')
			.replace(/\\"/g, '"');
	}

	if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
		return value.slice(1, -1);
	}

	return value;
}
