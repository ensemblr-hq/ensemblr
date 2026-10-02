import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { writeFileAtomicExclusive } from '../safe-fs/index.ts';
import { ENSEMBLR_DIRECTORY } from './repository-paths.ts';
import {
	assertSafeSettingsPath,
	settingsFilePath,
} from './settings-file-access.ts';

/** Starter contents written when a repo has no committed `.ensemblr/settings.toml` yet. */
const STARTER_TOML = `# Ensemblr repository settings (committed, shared with your team).
# The Scripts settings screen writes this file; comments are not preserved
# through an edit made there.
# See https://ensemblr.dev for the full reference.
#
# [git]
# branch_from = "main"
#
# [scripts]
# setup = "npm install"
# archive = "rm -rf node_modules"
# run_mode = "concurrent"          # or "nonconcurrent"
# auto_run_after_setup = false
#
# [scripts.run.dev]
# command = "PORT=$ENSEMBLR_PORT npm run dev"
# icon = "play"
# default = true
# available_in = ["local"]
#
# [prompts]
# review = "Focus on correctness and tests."
`;

/**
 * Ensures a repository's committed config file exists, creating the
 * `.ensemblr/` directory and a commented starter `settings.toml` when absent so
 * the user always has something to edit. An existing file is left untouched.
 *
 * The path lives inside the repository checkout, so a committed symlink at the
 * root, at `.ensemblr/`, or at the file itself is refused rather than written
 * through.
 * @param repositoryPath - Absolute repository root.
 * @returns The absolute path to the config file.
 * @throws When the repository has made its settings path unsafe.
 */
export function ensureRepositoryConfigFile(repositoryPath: string): string {
	assertSafeSettingsPath(repositoryPath);
	const directory = path.join(repositoryPath, ENSEMBLR_DIRECTORY);
	const filePath = settingsFilePath(repositoryPath);

	if (!existsSync(filePath)) {
		mkdirSync(directory, { mode: 0o700, recursive: true });
		assertSafeSettingsPath(repositoryPath);
		writeFileAtomicExclusive(filePath, STARTER_TOML);
	}

	return filePath;
}
