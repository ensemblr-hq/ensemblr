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
	createArchitectureService,
	readArchitectureFile,
} from '../../src/main/architecture/index.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import type { ArchitectureIR } from '../../src/shared/architecture-diagram.ts';

const execFileAsync = promisify(execFile);
const cleanups: (() => void)[] = [];

afterEach(() => {
	while (cleanups.length > 0) {
		cleanups.pop()?.();
	}
});

/**
 * A minimal valid document, as an agent would submit one.
 * @param title - The diagram's title, for telling two writes apart
 * @returns The IR
 */
function irNamed(title: string): ArchitectureIR {
	return {
		components: [
			{ col: 0, id: 'alpha', label: 'Alpha', row: 0, type: 'backend' },
		],
		meta: { title },
		schemaVersion: 1,
	};
}

/**
 * Materializes a git repository registered as a workspace in a fresh in-memory
 * database.
 * @returns The workspace id, its path, and the service under test
 */
async function createFixture(): Promise<{
	architectureService: ArchitectureService;
	cwd: string;
	database: DatabaseSync;
	workspaceId: string;
}> {
	const cwd = mkdtempSync(path.join(tmpdir(), 'ensemblr-architecture-'));
	cleanups.push(() => rmSync(cwd, { force: true, recursive: true }));
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

// Nothing derives a diagram. A workspace nobody has drawn has none, and that is
// an ordinary answer rather than a prompt to go and build one.
describe('architecture service: a workspace nobody has drawn', () => {
	it('answers that there is none, without error', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();

		const read = await architectureService.readDiagram({ workspaceId });
		expect(read.current).toBeNull();
		expect(read.error).toBeUndefined();
		expect(read.previous).toBeNull();
		expect(existsSync(architectureFilePath(cwd))).toBe(false);
	});

	it('still answers that there is none after a repeat read', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		await architectureService.readDiagram({ workspaceId });

		expect(
			(await architectureService.readDiagram({ workspaceId })).current,
		).toBeNull();
		expect(existsSync(architectureFilePath(cwd))).toBe(false);
	});

	it('refuses a workspace the database does not know', async () => {
		const { architectureService } = await createFixture();
		await expect(
			architectureService.readDiagram({ workspaceId: 'ws-missing' }),
		).rejects.toThrow(/No workspace with id/);
	});
});

describe('architecture service: an agent-authored diagram', () => {
	it('stores it and reads it back', async () => {
		const { architectureService, workspaceId } = await createFixture();
		await architectureService.storeRefinedIr({
			ir: irNamed('drawn'),
			workspaceId,
		});

		const read = await architectureService.readDiagram({ workspaceId });
		expect(read.current?.ir.meta.title).toBe('drawn');
		expect(read.current?.relativePath).toBe('.ensemblr/architecture.json');
	});

	it('reports what a write replaced, which is what the delta badges read', async () => {
		const { architectureService, workspaceId } = await createFixture();
		await architectureService.storeRefinedIr({
			ir: irNamed('first'),
			workspaceId,
		});
		await architectureService.storeRefinedIr({
			ir: irNamed('second'),
			workspaceId,
		});

		const read = await architectureService.readDiagram({ workspaceId });
		expect(read.current?.ir.meta.title).toBe('second');
		expect(read.previous?.meta.title).toBe('first');
	});

	it('badges nothing for the first write, which replaced nothing', async () => {
		const { architectureService, workspaceId } = await createFixture();
		await architectureService.storeRefinedIr({
			ir: irNamed('first'),
			workspaceId,
		});

		expect(
			(await architectureService.readDiagram({ workspaceId })).previous,
		).toBeNull();
	});

	// A write that replaced nothing has to clear what an earlier one left behind,
	// or the badges compare the new document against a snapshot two writes old.
	it('forgets what it replaced once the user deletes the diagram', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		await architectureService.storeRefinedIr({
			ir: irNamed('first'),
			workspaceId,
		});
		await architectureService.storeRefinedIr({
			ir: irNamed('second'),
			workspaceId,
		});
		rmSync(architectureFilePath(cwd));
		await architectureService.storeRefinedIr({
			ir: irNamed('third'),
			workspaceId,
		});

		const read = await architectureService.readDiagram({ workspaceId });
		expect(read.current?.ir.meta.title).toBe('third');
		expect(read.previous).toBeNull();
	});
});

describe('architecture service: the committed file', () => {
	it('writes the diagram to .ensemblr/architecture.json', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		await architectureService.storeRefinedIr({
			ir: irNamed('drawn'),
			workspaceId,
		});

		const filePath = architectureFilePath(cwd);
		expect(filePath).toBe(path.join(cwd, '.ensemblr', 'architecture.json'));
		const stored = JSON.parse(readFileSync(filePath, 'utf8'));
		expect(stored.ir.components.length).toBeGreaterThan(0);
		expect(typeof stored.generatedAt).toBe('string');
		// Provenance the scan used to record. Nothing derives a diagram now, so a
		// document carrying either field is a stale writer rather than history.
		expect(stored).not.toHaveProperty('source');
		expect(stored).not.toHaveProperty('graphFingerprint');
		expect(stored).not.toHaveProperty('treeHash');
	});

	it('writes readable, newline-terminated JSON, for reading in a diff', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		await architectureService.storeRefinedIr({
			ir: irNamed('drawn'),
			workspaceId,
		});

		const raw = readFileSync(architectureFilePath(cwd), 'utf8');
		expect(raw.endsWith('\n')).toBe(true);
		expect(raw).toContain('\n\t"ir": {');
	});
});

// The file is tracked, so a document this build cannot parse is somebody's
// work — a hand edit, a merge conflict, an update with one bad field. Every
// path stops on it rather than quietly writing a replacement over the top.
describe('architecture service: a document it cannot read', () => {
	it('reports the problem rather than answering "there is none"', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		mkdirSync(path.dirname(architectureFilePath(cwd)), { recursive: true });
		writeFileSync(architectureFilePath(cwd), '{ not json', 'utf8');

		const read = await architectureService.readDiagram({ workspaceId });
		expect(read.current).toBeNull();
		expect(read.error?.code).toBe('diagram-unreadable');
		expect(read.error?.message).toContain('.ensemblr/architecture.json');
	});

	it('names the field that failed when the IR is the problem', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		await architectureService.storeRefinedIr({
			ir: irNamed('drawn'),
			workspaceId,
		});
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

	it('refuses an update over it, and leaves the bytes untouched', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		await architectureService.storeRefinedIr({
			ir: irNamed('drawn'),
			workspaceId,
		});
		const handEdited = '{ "ir": { "components": [] } }';
		writeFileSync(architectureFilePath(cwd), handEdited, 'utf8');

		await expect(
			architectureService.storeRefinedIr({
				ir: irNamed('replacement'),
				workspaceId,
			}),
		).rejects.toThrow(/could not be read/);
		expect(readFileSync(architectureFilePath(cwd), 'utf8')).toBe(handEdited);
	});
});

// The writer creates the directories it needs, so without a re-check a write
// racing a delete recreates `.ensemblr/` inside a removed worktree and the next
// `git worktree add` at that path fails.
describe('architecture service: a workspace that goes away mid-write', () => {
	it('drops the write when the directory is gone', async () => {
		const { architectureService, cwd, workspaceId } = await createFixture();
		rmSync(cwd, { force: true, recursive: true });

		await expect(
			architectureService.storeRefinedIr({
				ir: irNamed('drawn'),
				workspaceId,
			}),
		).rejects.toThrow(/no longer on disk/);
		expect(existsSync(cwd)).toBe(false);
	});

	it('drops the write when the row is gone', async () => {
		const { architectureService, database, cwd, workspaceId } =
			await createFixture();
		database.exec(`DELETE FROM workspaces WHERE id = '${workspaceId}'`);

		await expect(
			architectureService.storeRefinedIr({
				ir: irNamed('drawn'),
				workspaceId,
			}),
		).rejects.toThrow(/No workspace with id/);
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

	// Only ENOENT means "there is nothing there". Every other rejection is a
	// document that exists and that an update must not write over.
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
		await architectureService.storeRefinedIr({
			ir: irNamed('drawn'),
			workspaceId,
		});
		expect(existsSync(`${architectureFilePath(cwd)}.tmp`)).toBe(false);
	});
});
