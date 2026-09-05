import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { readDiagramUpkeep } from '../../src/main/architecture/diagram-upkeep.ts';
import type { ArchitectureIR } from '../../src/shared/architecture-diagram.ts';

const DRAWN_AT = '2026-09-01T12:00:00.000Z';
const DRAWN_AT_MS = Date.parse(DRAWN_AT);

const IR: ArchitectureIR = {
	boundaries: [],
	components: [
		{
			id: 'storage',
			label: 'storage',
			sources: [{ path: 'src/main/storage' }],
			type: 'database',
		},
	],
	connections: [],
	meta: { title: 'repo' },
	schemaVersion: 1,
};

let workspace: string;

/** Writes a stored diagram document, stamped with the given authoring time. */
async function storeDiagram(generatedAt: string | number): Promise<void> {
	await mkdir(path.join(workspace, '.ensemblr'), { recursive: true });
	await writeFile(
		path.join(workspace, '.ensemblr', 'architecture.json'),
		JSON.stringify({ generatedAt, ir: IR }),
		'utf8',
	);
}

/** Writes a workspace file and stamps its mtime relative to the drawing time. */
async function writeSource(
	relativePath: string,
	offsetMs: number,
): Promise<void> {
	const full = path.join(workspace, relativePath);
	await mkdir(path.dirname(full), { recursive: true });
	await writeFile(full, 'export const x = 1;\n', 'utf8');
	const when = new Date(DRAWN_AT_MS + offsetMs);
	await utimes(full, when, when);
}

/** Builds the changed-paths reader the upkeep read takes. */
function changed(...paths: string[]): () => Promise<readonly string[]> {
	return async () => paths;
}

beforeEach(async () => {
	workspace = await mkdtemp(path.join(tmpdir(), 'diagram-upkeep-'));
});

afterEach(async () => {
	await rm(workspace, { force: true, recursive: true });
});

describe('readDiagramUpkeep', () => {
	// The user opted into a diagram by having one drawn. A workspace without one
	// must never be nudged into having one.
	test('reports nothing when the workspace has no diagram', async () => {
		await writeSource('src/main/storage/tx.ts', 60_000);

		expect(
			await readDiagramUpkeep({
				changedPaths: changed('src/main/storage/tx.ts'),
				workspaceCwd: workspace,
			}),
		).toEqual({ components: [], stale: false });
	});

	test('reports nothing when the change set is empty', async () => {
		await storeDiagram(DRAWN_AT);

		expect(
			(
				await readDiagramUpkeep({
					changedPaths: changed(),
					workspaceCwd: workspace,
				})
			).stale,
		).toBe(false);
	});

	test('reports nothing when the changes miss every component', async () => {
		await storeDiagram(DRAWN_AT);
		await writeSource('docs/adr/0001.md', 60_000);

		expect(
			(
				await readDiagramUpkeep({
					changedPaths: changed('docs/adr/0001.md'),
					workspaceCwd: workspace,
				})
			).stale,
		).toBe(false);
	});

	test('reports the component when its files moved after the drawing', async () => {
		await storeDiagram(DRAWN_AT);
		await writeSource('src/main/storage/tx.ts', 60_000);

		expect(
			await readDiagramUpkeep({
				changedPaths: changed('src/main/storage/tx.ts'),
				workspaceCwd: workspace,
			}),
		).toEqual({ components: ['storage'], stale: true });
	});

	// This is what makes the bullet self-clearing: storing an update stamps the
	// document with the current time, and every changed file is then older.
	test('falls silent once the diagram is newer than the changed files', async () => {
		await storeDiagram(DRAWN_AT);
		await writeSource('src/main/storage/tx.ts', -60_000);

		expect(
			(
				await readDiagramUpkeep({
					changedPaths: changed('src/main/storage/tx.ts'),
					workspaceCwd: workspace,
				})
			).stale,
		).toBe(false);
	});

	// A node drawing a directory somebody deleted is exactly the drawing that has
	// gone wrong, so a covered path that no longer exists counts as moved.
	test('treats a deleted covered path as a change', async () => {
		await storeDiagram(DRAWN_AT);

		expect(
			(
				await readDiagramUpkeep({
					changedPaths: changed('src/main/storage/gone.ts'),
					workspaceCwd: workspace,
				})
			).stale,
		).toBe(true);
	});

	test('stays silent over a diagram this build cannot read', async () => {
		await mkdir(path.join(workspace, '.ensemblr'), { recursive: true });
		await writeFile(
			path.join(workspace, '.ensemblr', 'architecture.json'),
			'{ not json',
			'utf8',
		);
		await writeSource('src/main/storage/tx.ts', 60_000);

		expect(
			(
				await readDiagramUpkeep({
					changedPaths: changed('src/main/storage/tx.ts'),
					workspaceCwd: workspace,
				})
			).stale,
		).toBe(false);
	});

	// An unmeasurable timestamp cannot ever be satisfied, so a nudge built on one
	// would repeat every turn with nothing that clears it.
	test('stays silent when the stored timestamp cannot be read', async () => {
		await storeDiagram('');
		await writeSource('src/main/storage/tx.ts', 60_000);

		expect(
			(
				await readDiagramUpkeep({
					changedPaths: changed('src/main/storage/tx.ts'),
					workspaceCwd: workspace,
				})
			).stale,
		).toBe(false);
	});

	test('stays silent when the change set cannot be read', async () => {
		await storeDiagram(DRAWN_AT);

		expect(
			(
				await readDiagramUpkeep({
					changedPaths: async () => {
						throw new Error('git is unavailable');
					},
					workspaceCwd: workspace,
				})
			).stale,
		).toBe(false);
	});
});
