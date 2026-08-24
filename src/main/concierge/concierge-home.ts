import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Filename of the memory index seeded into every Concierge session. */
export const CONCIERGE_MEMORY_INDEX_FILE = 'MEMORY.md';

/** Directory holding one markdown file per memory. */
export const CONCIERGE_MEMORY_DIRECTORY = 'memory';

/** Directory the Concierge writes reports and notes into. */
export const CONCIERGE_ARTIFACTS_DIRECTORY = 'artifacts';

/**
 * The Concierge's own corner of the Ensemblr root: its working directory, and
 * the only tree it is allowed to write into.
 */
export interface ConciergeHome {
	artifactsPath: string;
	memoryIndexPath: string;
	memoryPath: string;
	rootPath: string;
}

/** Body written into a fresh `MEMORY.md`, so the file is never an empty prompt. */
const MEMORY_INDEX_SEED = `# Memory Index

One line per memory, newest first. Each entry points at a file in \`memory/\`.
`;

/**
 * Derives the Concierge home layout from the managed concierge directory.
 * @param conciergePath - Absolute path of `<root>/concierge`.
 * @returns The paths that make up the home, without touching the filesystem.
 */
export function resolveConciergeHome(conciergePath: string): ConciergeHome {
	return {
		artifactsPath: path.join(conciergePath, CONCIERGE_ARTIFACTS_DIRECTORY),
		memoryIndexPath: path.join(conciergePath, CONCIERGE_MEMORY_INDEX_FILE),
		memoryPath: path.join(conciergePath, CONCIERGE_MEMORY_DIRECTORY),
		rootPath: conciergePath,
	};
}

/**
 * Creates the Concierge home and its subdirectories, seeding the memory index
 * when it is absent. Safe to call on every launch.
 * @param conciergePath - Absolute path of `<root>/concierge`.
 * @returns The resolved home.
 */
export function ensureConciergeHome(conciergePath: string): ConciergeHome {
	const home = resolveConciergeHome(conciergePath);

	mkdirSync(home.rootPath, { recursive: true });
	mkdirSync(home.memoryPath, { recursive: true });
	mkdirSync(home.artifactsPath, { recursive: true });
	if (!existsSync(home.memoryIndexPath)) {
		writeFileSync(home.memoryIndexPath, MEMORY_INDEX_SEED, 'utf8');
	}

	return home;
}

/**
 * Resolves a memory slug to its file path inside the home.
 * @param home - The Concierge home.
 * @param slug - Memory slug, which is also the file basename.
 * @returns Absolute path of the memory's markdown file.
 */
export function conciergeMemoryPath(home: ConciergeHome, slug: string): string {
	return path.join(home.memoryPath, `${slug}.md`);
}
