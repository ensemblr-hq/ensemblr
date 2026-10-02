/// <reference types="node" />

import assert from 'node:assert/strict';
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { writeContextActionPrompt } from '../../src/main/workspace-files/context-attachments.ts';

function createDirectory(t: TestContext, prefix: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), prefix));
	t.after(() => rmSync(directory, { force: true, recursive: true }));

	return directory;
}

test('writeContextActionPrompt writes the prompt under .context/attachments', async (t) => {
	const workspaceCwd = createDirectory(t, 'ensemblr-action-');

	const result = await writeContextActionPrompt({
		action: 'review',
		content: '# Review\n',
		workspaceCwd,
	});

	assert.ok('file' in result);
	assert.equal(
		readFileSync(
			path.join(workspaceCwd, '.context', 'attachments', 'ensemblr-review.md'),
			'utf8',
		),
		'# Review\n',
	);
});

test('writeContextActionPrompt replaces a committed symlink instead of writing through it', async (t) => {
	const workspaceCwd = createDirectory(t, 'ensemblr-action-');
	const victim = path.join(createDirectory(t, 'ensemblr-victim-'), 'zshenv');
	writeFileSync(victim, 'untouched');
	const attachments = path.join(workspaceCwd, '.context', 'attachments');
	mkdirSync(attachments, { recursive: true });
	const promptPath = path.join(attachments, 'ensemblr-review.md');
	symlinkSync(victim, promptPath);

	const result = await writeContextActionPrompt({
		action: 'review',
		content: 'export EVIL=1\n',
		workspaceCwd,
	});

	assert.ok('file' in result);
	assert.equal(readFileSync(victim, 'utf8'), 'untouched');
	assert.ok(!lstatSync(promptPath).isSymbolicLink());
});

test('writeContextActionPrompt refuses a workspace whose .context is a symlink', async (t) => {
	const workspaceCwd = createDirectory(t, 'ensemblr-action-');
	const victim = createDirectory(t, 'ensemblr-victim-');
	symlinkSync(victim, path.join(workspaceCwd, '.context'));

	const result = await writeContextActionPrompt({
		action: 'review',
		content: '# Review\n',
		workspaceCwd,
	});

	assert.equal(result.error?.code, 'invalid-path');
});
