/**
 * Reads the `.infisical.json` the Infisical CLI writes at a repository root.
 * A repository that has run `infisical init` already names its project there,
 * so Ensemblr treats the file as a read-only fallback rather than asking the
 * user to pick the same project a second time. Nothing is ever written back:
 * the file belongs to the CLI.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isPlainRecord } from '../config';

/** Filename the Infisical CLI writes at the repository root. */
export const INFISICAL_CLI_CONFIG_FILENAME = '.infisical.json';

/**
 * The half of a link a `.infisical.json` can supply. `siteUrl` comes from the
 * file's `domain`, which only a self-hosted repository sets — a null there
 * means Infisical Cloud, not an unknown instance.
 *
 * Two fields of the CLI's own schema are deliberately not read.
 * `defaultSecretPath` is skipped because a link built here reads the
 * environment root, matching `infisical run`'s own `--path` default.
 * `gitBranchToEnvironmentMapping` is skipped because the CLI resolves it
 * against the working tree's current branch, and this link is scoped to a
 * *repository* whose every workspace sits on a different branch — so there is
 * no one branch to resolve it against. A repository that maps environments per
 * branch therefore gets `defaultEnvironment` in every workspace, and the user
 * saves an explicit link when that is wrong.
 */
export interface InfisicalCliConfig {
	environmentSlug: string | null;
	projectId: string;
	siteUrl: string | null;
}

/**
 * Reads a repository's `.infisical.json`. An absent, unreadable, malformed, or
 * project-less file is not an error — it is a repository that has no CLI
 * config, which is the common case.
 * @param repositoryPath - Absolute path of the repository.
 * @returns The discovered project, or null when the file names none.
 */
export function readInfisicalCliConfig(
	repositoryPath: string,
): InfisicalCliConfig | null {
	const record = parseCliConfigFile(
		path.join(repositoryPath, INFISICAL_CLI_CONFIG_FILENAME),
	);

	if (!record) {
		return null;
	}

	const projectId = readString(record, 'workspaceId');

	if (!projectId) {
		return null;
	}

	return {
		environmentSlug: readString(record, 'defaultEnvironment'),
		projectId,
		siteUrl: readString(record, 'domain'),
	};
}

/**
 * Parses the CLI config file into a record, swallowing every read and parse
 * failure alike: a file the CLI wrote in a shape Ensemblr does not recognise
 * must never stop a workspace from opening.
 * @param filePath - Absolute path of the `.infisical.json`.
 * @returns The parsed record, or null when there is nothing usable to read.
 */
function parseCliConfigFile(filePath: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));

		return isPlainRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * Reads a non-empty string key off the parsed CLI config.
 * @param record - The parsed config.
 * @param key - Key to read.
 * @returns The trimmed value, or null when absent, non-string, or empty.
 */
function readString(
	record: Record<string, unknown>,
	key: string,
): string | null {
	const value = record[key];

	return typeof value === 'string' && value.trim() ? value.trim() : null;
}
