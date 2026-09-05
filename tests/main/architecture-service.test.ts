import { execFile } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
	type ArchitectureService,
	architectureFilePath,
	createArchitectureScanQueue,
	createArchitectureService,
	readArchitectureFile,
} from '../../src/main/architecture/index.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';

const execFileAsync = promisify(execFile);
const cleanups: (() => void)[] = [];

afterEach(() => {
	while (cleanups.length > 0) {
		cleanups.pop()?.();
	}
});

/**
 * Materializes a git repository with two module directories, registered as a
 * workspace in a fresh in-memory database.
 * @returns The workspace id, its path, and the service under test
 */
async function createFixture(): Promise<{
	architectureService: ArchitectureService;
	cwd: string;
	database: DatabaseSync;
	writeFile: (relative: string, contents: string) => void;
	workspaceId: string;
}> {
	const cwd = mkdtempSync(path.join(tmpdir(), 'ensemblr-architecture-'));
	cleanups.push(() => rmSync(cwd, { force: true, recursive: true }));
	const writeFile = (relative: string, contents: string) => {
		const absolute = path.join(cwd, relative);
		mkdirSync(path.dirname(absolute), { recursive: true });
		writeFileSync(absolute, contents, 'utf8');
	};
	writeFile(
		'src/main/ipc/handlers.ts',
		"import { readRow } from '../storage/rows.ts';\nexport const handle = () => readRow();\n",
	);
	writeFile('src/main/storage/rows.ts', 'export const readRow = () => 1;\n');
	await execFileAsync('git', ['init', '--quiet'], { cwd });

	const connection = openEnsemblrDatabase({ databasePath: ':memory:' });
	cleanups.push(() => connection.database.close());
	seedWorkspace(connection.database, cwd);

	return {
		architectureService: createArchitectureService({
			requireDatabase: () => connection.database,
		}),
		cwd,
		database: connection.database,
		workspaceId: 'ws-1',
		writeFile,
	};
}

/**
 * Inserts the repository and workspace rows the service resolves a cwd from.
 * @param database - Open database handle
 * @param cwd - Absolute workspace path
 */
function seedWorkspace(database: DatabaseSync, cwd: string): void {
	database.exec(`
		INSERT INTO repositories (id, slug, name, path) VALUES ('repo-1', 'r', 'R', '${cwd}-origin');
		INSERT INTO workspaces (id, repository_id, name, slug, path)
		VALUES ('ws-1', 'repo-1', 'W', 'w', '${cwd}');
	`);
}

describe('architecture service: the seed scan', () => {
	it('builds a snapshot the first time it is asked', async () => {
		const { architectureService, workspaceId } = await createFixture();
		const outcome = await architectureService.scanIfMissing({ workspaceId });
		expect(outcome.rebuilt).toBe(true);
		expect(
			(await architectureService.readDiagram({ workspaceId })).current,
		).not.toBeNull();
	});

	// The seed is scanned once, at workspace creation. Everything after it is an
	// agent's refinement, so a second scan has nothing to add and everything to
	// overwrite.
	it('leaves a workspace that already has a diagram alone', async () => {
		const { architectureService, workspaceId } = await createFixture();
		await architectureService.scanIfMissing({ workspaceId });
		expect(await architectureService.scanIfMissing({ workspaceId })).toEqual({
			reason: 'already-stored',
			rebuilt: false,
		});
	});

	it('leaves it alone even after the module graph moves', async () => {
		const { architectureService, workspaceId, writeFile } =
			await createFixture();
		await architectureService.scanIfMissing({ workspaceId });
		writeFile('src/shared/ipc/channels.ts', 'export const channel = "x";\n');
		expect(await architectureService.scanIfMissing({ workspaceId })).toEqual({
			reason: 'already-stored',
			rebuilt: false,
		});
	});

	it('refuses a workspace the database does not know', async () => {
		const { architectureService } = await createFixture();
		await expect(
			architectureService.scanIfMissing({ workspaceId: 'ws-missing' }),
		).rejects.toThrow(/No workspace with id/);
	});
});

describe('architecture service: agent refinements', () => {
	it('stores a refined document as the current snapshot', async () => {
		const { architectureService, workspaceId } = await createFixture();
		await architectureService.scanIfMissing({ workspaceId });
		const refined = {
			components: [
				{
					col: 0,
					id: 'alpha',
					label: 'Alpha',
					row: 0,
					type: 'backend' as const,
				},
			],
			meta: { title: 'refined' },
			schemaVersion: 1,
		};
		await architectureService.storeRefinedIr({ ir: refined, workspaceId });
		const { current, previous } = await architectureService.readDiagram({
			workspaceId,
		});
		expect(current?.source).toBe('agent');
		expect(current?.ir.meta.title).toBe('refined');
		// `previous` is the document this write replaced, which is how the panel
		// badges what moved.
		expect(previous?.meta.title).not.toBe('refined');
	});

	it('keeps the refinement rather than scanning over it', async () => {
		const { architectureService, workspaceId, writeFile } =
			await createFixture();
		await architectureService.scanIfMissing({ workspaceId });
		await architectureService.storeRefinedIr({
			ir: {
				components: [
					{
						col: 0,
						id: 'alpha',
						label: 'Alpha',
						row: 0,
						type: 'backend' as const,
					},
				],
				meta: { title: 'refined' },
				schemaVersion: 1,
			},
			workspaceId,
		});
		writeFile('src/renderer/state/atoms.ts', 'export const atom = 1;\n');
		expect(await architectureService.scanIfMissing({ workspaceId })).toEqual({
			reason: 'already-stored',
			rebuilt: false,
		});
		expect(
			(await architectureService.readDiagram({ workspaceId })).current?.ir.meta
				.title,
		).toBe('refined');
	});

	it('keeps the fingerprint the seed recorded, as provenance', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		await architectureService.scanIfMissing({ workspaceId });
		const seeded = JSON.parse(readFileSync(architectureFilePath(cwd), 'utf8'));
		await architectureService.storeRefinedIr({
			ir: {
				components: [
					{ col: 0, id: 'alpha', label: 'Alpha', row: 0, type: 'backend' },
				],
				meta: { title: 'refined' },
				schemaVersion: 1,
			},
			workspaceId,
		});
		const refined = JSON.parse(readFileSync(architectureFilePath(cwd), 'utf8'));
		expect(refined.graphFingerprint).toBe(seeded.graphFingerprint);
	});
});

describe('architecture service: the committed file', () => {
	it('writes the diagram to .ensemblr/architecture.json', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		await architectureService.scanIfMissing({ workspaceId });

		const filePath = architectureFilePath(cwd);
		expect(filePath).toBe(path.join(cwd, '.ensemblr', 'architecture.json'));
		const stored = JSON.parse(readFileSync(filePath, 'utf8'));
		expect(stored.source).toBe('scan');
		expect(stored.ir.components.length).toBeGreaterThan(0);
		expect(typeof stored.graphFingerprint).toBe('string');
		// The working-tree hash is a machine-local cache key and must never reach
		// the committed file: it would churn every diff, and writing the file moves
		// the tree it describes.
		expect(stored).not.toHaveProperty('treeHash');
	});

	it('writes readable, newline-terminated JSON, for reading in a diff', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		await architectureService.scanIfMissing({ workspaceId });

		const raw = readFileSync(architectureFilePath(cwd), 'utf8');
		expect(raw.endsWith('\n')).toBe(true);
		expect(raw).toContain('\n\t"ir": {');
	});
});

// The file is tracked, so a document this build cannot parse is somebody's
// work — a hand edit, a merge conflict, a refinement with one bad field. Every
// path stops on it rather than quietly scanning a replacement over the top,
// which is how a refinement used to disappear with the read still reporting
// `source: "scan"` as though nothing had happened.
describe('architecture service: a document it cannot read', () => {
	it('reports the problem rather than answering "there is none"', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		await architectureService.scanIfMissing({ workspaceId });
		writeFileSync(architectureFilePath(cwd), '{ not json', 'utf8');

		const read = await architectureService.readDiagram({ workspaceId });
		expect(read.current).toBeNull();
		expect(read.error?.code).toBe('diagram-unreadable');
		expect(read.error?.message).toContain('.ensemblr/architecture.json');
	});

	it('names the field that failed when the IR is the problem', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		await architectureService.scanIfMissing({ workspaceId });
		const stored = JSON.parse(readFileSync(architectureFilePath(cwd), 'utf8'));
		stored.ir.components[0].type = 'not-a-type';
		writeFileSync(
			architectureFilePath(cwd),
			JSON.stringify(stored, null, '\t'),
			'utf8',
		);

		const read = await architectureService.readDiagram({ workspaceId });
		expect(read.error?.message).toContain('components.0.type');
	});

	it('refuses to scan over it, and leaves the bytes untouched', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		await architectureService.scanIfMissing({ workspaceId });
		writeFileSync(architectureFilePath(cwd), '{ not json', 'utf8');

		expect(await architectureService.scanIfMissing({ workspaceId })).toEqual({
			reason: 'diagram-unreadable',
			rebuilt: false,
		});
		expect(readFileSync(architectureFilePath(cwd), 'utf8')).toBe('{ not json');
	});
});

describe('architecture service: the first read', () => {
	// The agent-control read port seeds when nothing is stored, so an agent is
	// never told the diagram is missing and sent hunting for the scanner.
	it('produces a snapshot for a workspace that has never had one', async () => {
		const { architectureService, workspaceId } = await createFixture();
		const first = await architectureService.readDiagram({ workspaceId });
		expect(first.current).toBeNull();
		expect(first.error).toBeUndefined();

		const outcome = await architectureService.scanIfMissing({ workspaceId });
		expect(outcome.rebuilt).toBe(true);
		expect(
			(await architectureService.readDiagram({ workspaceId })).current?.source,
		).toBe('scan');
	});
});

describe('architecture scan queue', () => {
	it('collapses a burst of asks into one scan per workspace', async () => {
		const calls: string[] = [];
		const queue = createArchitectureScanQueue({
			architectureService: {
				readDiagram: async () => ({ current: null, previous: null }),
				scanIfMissing: async ({ workspaceId }: { workspaceId: string }) => {
					calls.push(workspaceId);
					await new Promise((resolve) => setTimeout(resolve, 5));
					return { reason: 'already-stored', rebuilt: false };
				},
				storeRefinedIr: () => {
					throw new Error('not used');
				},
			} as unknown as ArchitectureService,
		});
		queue.queueScan({ workspaceId: 'ws-1' });
		queue.queueScan({ workspaceId: 'ws-1' });
		queue.queueScan({ workspaceId: 'ws-1' });
		await queue.awaitInFlight();
		expect(calls).toEqual(['ws-1', 'ws-1']);
	});

	it('keeps a failed scan off the caller’s path', async () => {
		const queue = createArchitectureScanQueue({
			architectureService: {
				scanIfMissing: async () => {
					throw new Error('scan exploded');
				},
			} as unknown as ArchitectureService,
		});
		expect(() => queue.queueScan({ workspaceId: 'ws-1' })).not.toThrow();
		await expect(queue.awaitInFlight()).resolves.toBeUndefined();
	});
});

describe('architecture service: scanIfMissingAndRead', () => {
	it('seeds and returns the diagram it wrote, in one call', async () => {
		const { architectureService, workspaceId } = await createFixture();
		const result = await architectureService.scanIfMissingAndRead({
			workspaceId,
		});
		expect(result.rebuilt).toBe(true);
		expect(result.current?.source).toBe('scan');
		expect(result.error).toBeUndefined();
		expect(result.previous).toBeNull();
	});

	it('returns the stored diagram without rebuilding it', async () => {
		const { architectureService, workspaceId } = await createFixture();
		await architectureService.scanIfMissing({ workspaceId });
		const result = await architectureService.scanIfMissingAndRead({
			workspaceId,
		});
		expect(result.rebuilt).toBe(false);
		expect(result.current?.source).toBe('scan');
	});

	it('reports an unreadable document rather than scanning over it', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		await architectureService.scanIfMissing({ workspaceId });
		writeFileSync(architectureFilePath(cwd), '{ not json', 'utf8');

		const result = await architectureService.scanIfMissingAndRead({
			workspaceId,
		});
		expect(result).toMatchObject({ current: null, rebuilt: false });
		expect(result.error?.code).toBe('diagram-unreadable');
		expect(readFileSync(architectureFilePath(cwd), 'utf8')).toBe('{ not json');
	});

	// Two panels opening on one fresh workspace used to interleave between the
	// scan and the read, so the first reported `rebuilt` against a document its
	// own scan had not written.
	it('lets only one of two concurrent asks claim the rebuild', async () => {
		const { architectureService, workspaceId } = await createFixture();
		const [first, second] = await Promise.all([
			architectureService.scanIfMissingAndRead({ workspaceId }),
			architectureService.scanIfMissingAndRead({ workspaceId }),
		]);
		expect([first.rebuilt, second.rebuilt].filter(Boolean)).toHaveLength(1);
		expect(first.current?.generatedAt).toBe(second.current?.generatedAt);
	});
});

describe('architecture service: an agent refinement over a document it cannot read', () => {
	it('refuses rather than overwriting somebody’s hand edit', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		await architectureService.scanIfMissing({ workspaceId });
		const handEdited = '{ "ir": { "components": [] } }';
		writeFileSync(architectureFilePath(cwd), handEdited, 'utf8');

		await expect(
			architectureService.storeRefinedIr({
				ir: {
					components: [
						{ id: 'alpha', label: 'Alpha', type: 'backend' as const },
					],
					meta: { title: 'refined' },
					schemaVersion: 1,
				},
				workspaceId,
			}),
		).rejects.toThrow(/could not be read/);
		expect(readFileSync(architectureFilePath(cwd), 'utf8')).toBe(handEdited);
	});
});

// A scan started at workspace creation outlives a workspace deleted a second
// later. The writer creates the directories it needs, so without a re-check the
// finished walk recreates `.ensemblr/` inside a removed worktree and the next
// `git worktree add` at that path fails.
describe('architecture service: a workspace that goes away mid-scan', () => {
	it('drops the write when the directory is gone', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		rmSync(cwd, { force: true, recursive: true });

		await expect(
			architectureService.scanIfMissing({ workspaceId }),
		).rejects.toThrow(/no longer on disk/);
		expect(existsSync(cwd)).toBe(false);
	});

	it('drops the write when the row is gone', async () => {
		const { architectureService, database, cwd, workspaceId } =
			await createFixture();
		const scan = architectureService.scanIfMissing({ workspaceId });
		database.exec(`DELETE FROM workspaces WHERE id = '${workspaceId}'`);

		await expect(scan).rejects.toThrow(/No workspace with id/);
		expect(existsSync(architectureFilePath(cwd))).toBe(false);
	});
});

describe('readArchitectureFile', () => {
	/**
	 * Materializes a workspace directory with a diagram file of given bytes.
	 * @param raw - What to write at `.ensemblr/architecture.json`
	 * @returns The absolute workspace root
	 */
	function writeDiagram(raw: string): string {
		const cwd = mkdtempSync(path.join(tmpdir(), 'ensemblr-diagram-'));
		cleanups.push(() => rmSync(cwd, { force: true, recursive: true }));
		mkdirSync(path.join(cwd, '.ensemblr'), { recursive: true });
		writeFileSync(architectureFilePath(cwd), raw, 'utf8');
		return cwd;
	}

	it('reports a missing file as absent', async () => {
		const cwd = mkdtempSync(path.join(tmpdir(), 'ensemblr-diagram-'));
		cleanups.push(() => rmSync(cwd, { force: true, recursive: true }));
		expect(await readArchitectureFile(cwd)).toEqual({ status: 'absent' });
	});

	// Only ENOENT means "there is nothing to lose". Every other rejection is a
	// document that exists and that the seed scan must not write over.
	it('reports a directory in the file’s place as unreadable', async () => {
		const cwd = mkdtempSync(path.join(tmpdir(), 'ensemblr-diagram-'));
		cleanups.push(() => rmSync(cwd, { force: true, recursive: true }));
		mkdirSync(architectureFilePath(cwd), { recursive: true });

		const read = await readArchitectureFile(cwd);
		expect(read.status).toBe('unreadable');
		expect(read.status === 'unreadable' && read.problem).toContain('EISDIR');
	});

	it('reports a file holding only `null` as unreadable rather than throwing', async () => {
		const read = await readArchitectureFile(writeDiagram('null'));
		expect(read.status).toBe('unreadable');
		expect(read.status === 'unreadable' && read.problem).toContain(
			'not a JSON object',
		);
	});

	it('reports a top-level array as unreadable', async () => {
		const read = await readArchitectureFile(writeDiagram('[]'));
		expect(read.status).toBe('unreadable');
	});

	it('refuses a document too large to be a diagram', async () => {
		const read = await readArchitectureFile(
			writeDiagram(`{"pad":"${'x'.repeat(5 * 1024 * 1024)}"}`),
		);
		expect(read.status).toBe('unreadable');
		expect(read.status === 'unreadable' && read.problem).toContain('ceiling');
	});
});

describe('writeArchitectureFile', () => {
	it('refuses a diagram the reader would reject, and leaves no file behind', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		await expect(
			architectureService.storeRefinedIr({
				ir: {
					components: [
						{ id: 'alpha', label: 'Alpha', type: 'backend' as const },
						{ id: 'alpha', label: 'Alpha again', type: 'backend' as const },
					],
					meta: { title: 'refined' },
					schemaVersion: 1,
				},
				workspaceId,
			}),
		).rejects.toThrow(/would not load back/);
		expect(existsSync(architectureFilePath(cwd))).toBe(false);
		expect(existsSync(`${architectureFilePath(cwd)}.tmp`)).toBe(false);
	});

	it('leaves no temporary file beside a diagram it did write', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		await architectureService.scanIfMissing({ workspaceId });
		expect(existsSync(`${architectureFilePath(cwd)}.tmp`)).toBe(false);
	});
});
