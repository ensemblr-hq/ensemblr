import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
	ENSEMBLR_DIRECTORY,
	ENSEMBLR_SETTINGS_FILENAME,
} from './repository-config.ts';

/** Starter contents written when a repo has no committed `.ensemblr/settings.toml` yet. */
const STARTER_TOML = `# Ensemblr repository settings (committed, shared with your team).
# See https://ensemblr.dev for the full reference.
#
# [git]
# branch_from = "main"
#
# [scripts]
# setup = "npm install"
# run = "npm run dev"
#
# Need more than one dev server? "run" also accepts an array of named
# targets instead of a single string, each start/stop-able on its own:
# [[scripts.run]]
# name = "Web"
# command = "npm run dev:web"
#
# [[scripts.run]]
# name = "API"
# command = "npm run dev:api"
#
# [prompts]
# review = "Focus on correctness and tests."
`;

/**
 * Ensures a repository's committed config file exists, creating the
 * `.ensemblr/` directory and a commented starter `settings.toml` when absent so
 * the user always has something to edit. An existing file is left untouched.
 * @param repositoryPath - Absolute repository root.
 * @returns The absolute path to the config file.
 */
export function ensureRepositoryConfigFile(repositoryPath: string): string {
	const directory = path.join(repositoryPath, ENSEMBLR_DIRECTORY);
	const filePath = path.join(directory, ENSEMBLR_SETTINGS_FILENAME);

	if (!existsSync(filePath)) {
		mkdirSync(directory, { recursive: true });
		writeFileSync(filePath, STARTER_TOML, 'utf8');
	}

	return filePath;
}
