import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createLinkedDirectoryService } from '../../src/main/linked-directories/linked-directory-service.ts';
import type { EnsemblrDatabaseService } from '../../src/main/storage/index.ts';

/**
 * Database service with no open connection. The recents list then reads as empty
 * and writes are dropped, which is the shape `record` has to survive anyway — it
 * leaves the path validation this suite is about as the only behaviour under
 * test.
 */
const databaseService: EnsemblrDatabaseService = {
	close: () => undefined,
	getConnection: () => null,
	getHealth: () => {
		throw new Error('getHealth is not used by the linked-directory service.');
	},
	open: () => {
		throw new Error('open is not used by the linked-directory service.');
	},
};

const service = createLinkedDirectoryService({ databaseService });

let root = '';

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'ensemblr-linked-'));
});

afterEach(async () => {
	await rm(root, { force: true, recursive: true });
});

describe('linked directory record', () => {
	test('rejects an empty path', async () => {
		const result = await service.record({ path: '   ' });

		expect(result.error?.code).toBe('invalid-path');
		expect(result.directory).toBeUndefined();
	});

	test('rejects a relative path, which no runtime could grant', async () => {
		const result = await service.record({ path: 'Documents/Vault' });

		expect(result.error?.code).toBe('invalid-path');
		expect(result.directory).toBeUndefined();
	});

	test('reports a path that is not there as read-failed', async () => {
		const result = await service.record({ path: path.join(root, 'absent') });

		expect(result.error?.code).toBe('read-failed');
		expect(result.directory).toBeUndefined();
	});

	test('rejects a file, since only a directory can be granted', async () => {
		const filePath = path.join(root, 'notes.md');
		await writeFile(filePath, '# notes\n');

		const result = await service.record({ path: filePath });

		expect(result.error?.code).toBe('not-a-directory');
		expect(result.directory).toBeUndefined();
	});

	test('accepts a directory and names it by its basename', async () => {
		const directoryPath = path.join(root, 'Vault 111');
		await mkdir(directoryPath);

		const result = await service.record({ path: directoryPath });

		expect(result.error).toBeUndefined();
		expect(result.directory).toEqual({
			exists: true,
			lastUsedAt: expect.any(String),
			name: 'Vault 111',
			path: directoryPath,
		});
		expect(result.entries.map((entry) => entry.path)).toEqual([directoryPath]);
	});

	test('normalises redundant segments so one folder occupies one row', async () => {
		const directoryPath = path.join(root, 'designs');
		await mkdir(directoryPath);

		const result = await service.record({
			path: path.join(root, 'designs', '..', 'designs', '.'),
		});

		expect(result.directory?.path).toBe(directoryPath);
	});

	test('keeps the symlink the user picked instead of its target', async () => {
		const targetPath = path.join(root, 'target');
		const linkPath = path.join(root, 'shortcut');
		await mkdir(targetPath);
		await symlink(targetPath, linkPath, 'dir');

		const result = await service.record({ path: linkPath });

		expect(result.directory?.path).toBe(linkPath);
		expect(result.directory?.name).toBe('shortcut');
	});
});

describe('linked directory list and forget', () => {
	test('reads as empty when no connection is open', async () => {
		expect(await service.list()).toEqual({ entries: [] });
	});

	test('forgetting an unknown path leaves the list empty rather than throwing', async () => {
		expect(await service.forget({ path: '/tmp/never-linked' })).toEqual({
			entries: [],
		});
	});
});
