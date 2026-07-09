import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createLocalCommandService } from '../../src/main/commands/local-command';
import { createListWorkspaceFilesService } from '../../src/main/workspace-files/list-workspace-files';

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { force: true, recursive: true });
		}
	}
});

function git(cwd: string, args: string[]): void {
	execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/**
 * Builds a temp repo with tracked files plus ignored entries: a small ignored
 * directory with nested contents (`.context/`), a larger ignored directory
 * (`node_modules/`), and an individually-ignored file (`debug.log`).
 */
function seedRepo(): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'ensemble-list-files-'));
	tempDirs.push(dir);
	git(dir, ['init', '-b', 'main']);
	git(dir, ['config', 'user.email', 'test@ensemble.dev']);
	git(dir, ['config', 'user.name', 'Ensemble Test']);
	writeFileSync(
		path.join(dir, '.gitignore'),
		'.context/\nnode_modules/\n*.log\n',
	);
	writeFileSync(path.join(dir, 'README.md'), '# demo\n');
	mkdirSync(path.join(dir, 'src'));
	writeFileSync(path.join(dir, 'src', 'app.ts'), 'export const x = 1;\n');
	git(dir, ['add', '.']);
	git(dir, ['commit', '-m', 'init']);

	// Small ignored directory with nested contents — should be browsable.
	mkdirSync(path.join(dir, '.context', 'sessions'), { recursive: true });
	writeFileSync(path.join(dir, '.context', 'sessions', 'tab.md'), 'summary\n');

	// Larger ignored directory — should collapse past a small cap.
	for (const pkg of ['react', 'lodash', 'zod']) {
		mkdirSync(path.join(dir, 'node_modules', pkg), { recursive: true });
		writeFileSync(path.join(dir, 'node_modules', pkg, 'index.js'), '\n');
		writeFileSync(path.join(dir, 'node_modules', pkg, 'package.json'), '{}\n');
	}
	writeFileSync(path.join(dir, 'node_modules', 'react', '.DS_Store'), '\n');

	// Individually-ignored file.
	writeFileSync(path.join(dir, 'debug.log'), 'noise\n');

	// Untracked OS/system junk that must be hidden outright, not just dimmed.
	writeFileSync(path.join(dir, '.DS_Store'), '\n');
	writeFileSync(path.join(dir, 'src', '.DS_Store'), '\n');
	writeFileSync(path.join(dir, '._resource'), '\n');
	return dir;
}

function listFiles(cwd: string, ignoredRootMaxEntries?: number) {
	const service = createListWorkspaceFilesService({
		ignoredRootMaxEntries,
		localCommandService: createLocalCommandService(),
	});
	return service.list({ workspaceCwd: cwd });
}

function readDir(cwd: string, dirPath: string) {
	const service = createListWorkspaceFilesService({
		localCommandService: createLocalCommandService(),
	});
	return service.readDirectory({ path: dirPath, workspaceCwd: cwd });
}

describe('createListWorkspaceFilesService.list', () => {
	test('enumerates ignored directory contents so they are browsable', async () => {
		const result = await listFiles(seedRepo());

		expect(result.error).toBeUndefined();
		const byPath = new Map(result.files.map((entry) => [entry.path, entry]));

		// Tracked entries are present and not dimmed.
		expect(byPath.get('README.md')?.isIgnored).toBeFalsy();
		expect(byPath.get('src')?.kind).toBe('directory');
		expect(byPath.get('src')?.isIgnored).toBeFalsy();
		expect(byPath.get('src/app.ts')?.isIgnored).toBeFalsy();

		// The ignored directory AND its nested contents are listed and dimmed,
		// so the user can expand it to see its files.
		expect(byPath.get('.context')).toMatchObject({
			isIgnored: true,
			kind: 'directory',
		});
		expect(byPath.get('.context/sessions')).toMatchObject({
			isIgnored: true,
			kind: 'directory',
		});
		expect(byPath.get('.context/sessions/tab.md')).toMatchObject({
			isIgnored: true,
			kind: 'file',
		});

		// An individually-ignored file is dimmed too.
		expect(byPath.get('debug.log')).toMatchObject({
			isIgnored: true,
			kind: 'file',
		});
	});

	test('collapses ignored directories larger than the cap', async () => {
		// node_modules holds ~10 entries; cap at 5 forces it to collapse while the
		// small .context directory still enumerates.
		const result = await listFiles(seedRepo(), 5);
		const byPath = new Map(result.files.map((entry) => [entry.path, entry]));

		expect(byPath.get('node_modules')).toMatchObject({
			isIgnored: true,
			kind: 'directory',
		});
		const nodeModulesChildren = result.files.filter((entry) =>
			entry.path.startsWith('node_modules/'),
		);
		expect(nodeModulesChildren).toHaveLength(0);

		// The small ignored directory is still fully enumerated.
		expect(byPath.get('.context/sessions/tab.md')).toMatchObject({
			isIgnored: true,
			kind: 'file',
		});
	});

	test('never surfaces the .git metadata directory', async () => {
		const result = await listFiles(seedRepo());

		const gitEntries = result.files.filter(
			(entry) => entry.path === '.git' || entry.path.startsWith('.git/'),
		);
		expect(gitEntries).toHaveLength(0);
	});

	test('hides .DS_Store and AppleDouble junk at any depth', async () => {
		const result = await listFiles(seedRepo());
		const paths = result.files.map((entry) => entry.path);

		expect(paths).not.toContain('.DS_Store');
		expect(paths).not.toContain('src/.DS_Store');
		expect(paths).not.toContain('._resource');
		// A real file in the same folder as junk still lists.
		expect(paths).toContain('src/app.ts');
	});
});

describe('createListWorkspaceFilesService.readDirectory', () => {
	test('reads a single directory level, tagging children ignored', async () => {
		const result = await readDir(seedRepo(), 'node_modules');

		expect(result.error).toBeUndefined();
		const byPath = new Map(result.entries.map((entry) => [entry.path, entry]));

		// Immediate children only — the package dirs, each dimmed.
		expect(byPath.get('node_modules/react')).toMatchObject({
			isIgnored: true,
			kind: 'directory',
		});
		expect(byPath.get('node_modules/lodash')?.kind).toBe('directory');
		// Not recursive: deeper files load on their own expand.
		expect(byPath.has('node_modules/react/index.js')).toBe(false);
	});

	test('reads nested ignored files on the next level', async () => {
		const result = await readDir(seedRepo(), 'node_modules/react');
		const paths = result.entries.map((entry) => entry.path);

		expect(paths).toContain('node_modules/react/index.js');
		expect(paths).toContain('node_modules/react/package.json');
		expect(result.entries.every((entry) => entry.isIgnored)).toBe(true);
		// System junk stays hidden even inside an ignored directory.
		expect(paths).not.toContain('node_modules/react/.DS_Store');
	});

	test('rejects a path that escapes the workspace', async () => {
		const result = await readDir(seedRepo(), '../../etc');

		expect(result.error?.code).toBe('invalid-path');
		expect(result.entries).toHaveLength(0);
	});

	test('errors when the path is a file, not a directory', async () => {
		const result = await readDir(seedRepo(), 'README.md');

		expect(result.error?.code).toBe('not-directory');
	});
});
