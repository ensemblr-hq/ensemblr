import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listConciergeArtifacts } from '../../src/main/concierge/concierge-artifacts.ts';
import type { ConciergeHome } from '../../src/main/concierge/concierge-home.ts';

let directory: string;
let home: ConciergeHome;

/**
 * Writes one artifact, creating its folders, and stamps it so the newest-first
 * ordering has something to sort on.
 * @param relativePath - Path under `artifacts/`.
 * @param modifiedAt - The mtime to stamp, as epoch seconds.
 */
const writeArtifact = (relativePath: string, modifiedAt: number): void => {
	const absolutePath = path.join(home.artifactsPath, relativePath);
	mkdirSync(path.dirname(absolutePath), { recursive: true });
	writeFileSync(absolutePath, relativePath, 'utf8');
	utimesSync(absolutePath, modifiedAt, modifiedAt);
};

beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-artifacts-'));
	home = {
		artifactsPath: path.join(directory, 'artifacts'),
		memoryIndexPath: path.join(directory, 'MEMORY.md'),
		memoryPath: path.join(directory, 'memory'),
		rootPath: directory,
	};
	mkdirSync(home.artifactsPath, { recursive: true });
});

afterEach(() => {
	rmSync(directory, { force: true, recursive: true });
});

describe('listing the Concierge’s artifacts', () => {
	// What the user just asked it to write is what they are about to reach for,
	// and the `@` menu shows the head of this list before any query narrows it.
	it('reports the most recently written first, across folders', async () => {
		writeArtifact('old-notes.md', 1_700_000_000);
		writeArtifact('releases/beta-plan.md', 1_800_000_000);
		writeArtifact('middle.md', 1_750_000_000);

		const artifacts = await listConciergeArtifacts(home);

		expect(artifacts.map((artifact) => artifact.relativePath)).toEqual([
			'releases/beta-plan.md',
			'middle.md',
			'old-notes.md',
		]);
		expect(artifacts[0]).toMatchObject({
			name: 'beta-plan.md',
			size: 'releases/beta-plan.md'.length,
		});
	});

	// A folder row in the `@` menu opens nothing, and a dotfile is bookkeeping
	// the Concierge never meant to hand back.
	it('lists neither the folders it walks nor anything hidden', async () => {
		writeArtifact('releases/beta-plan.md', 1_800_000_000);
		writeArtifact('.scratch/draft.md', 1_800_000_001);
		writeArtifact('.hidden.md', 1_800_000_002);

		const artifacts = await listConciergeArtifacts(home);

		expect(artifacts.map((artifact) => artifact.relativePath)).toEqual([
			'releases/beta-plan.md',
		]);
	});

	// The walk stops where the reference validator stops accepting paths, so the
	// menu can never offer a row whose link would be refused on the way back.
	it('stops at the depth an artifact reference can address', async () => {
		writeArtifact('a/b/c/d/reachable.md', 1_800_000_000);
		writeArtifact('a/b/c/d/e/too-deep.md', 1_800_000_001);

		const artifacts = await listConciergeArtifacts(home);

		expect(artifacts.map((artifact) => artifact.relativePath)).toEqual([
			'a/b/c/d/reachable.md',
		]);
	});

	// The directory is seeded at launch, but a listing that raced that seeding
	// would take the whole `@` menu down with it.
	it('lists an absent artifacts directory as empty', async () => {
		rmSync(home.artifactsPath, { force: true, recursive: true });

		await expect(listConciergeArtifacts(home)).resolves.toEqual([]);
	});
});
