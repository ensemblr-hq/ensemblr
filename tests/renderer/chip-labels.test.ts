import { expect, test } from 'vitest';

import {
	chipLabelForPath,
	chipLabelsForPaths,
} from '@/renderer/lib/agent-timeline';

test('a path on its own is labelled by its file name', () => {
	expect(chipLabelForPath('src/renderer/components/message.tsx')).toBe(
		'message.tsx',
	);
	expect(chipLabelForPath('README.md')).toBe('README.md');
	expect(chipLabelForPath('src/renderer/components/')).toBe('components');
});

test('file names that do not collide stay bare', () => {
	const labels = chipLabelsForPaths([
		'src/app.ts',
		'tests/main/workspace-git-status.test.ts',
		'AGENTS.md',
	]);

	expect(labels.get('src/app.ts')).toBe('app.ts');
	expect(labels.get('tests/main/workspace-git-status.test.ts')).toBe(
		'workspace-git-status.test.ts',
	);
	expect(labels.get('AGENTS.md')).toBe('AGENTS.md');
});

test('two files sharing a name take on the directory that tells them apart', () => {
	const labels = chipLabelsForPaths([
		'tests/main/agent-control-tool-namespacing.test.ts',
		'tests/renderer/agent-control-tool-namespacing.test.ts',
	]);

	expect(labels.get('tests/main/agent-control-tool-namespacing.test.ts')).toBe(
		'main/agent-control-tool-namespacing.test.ts',
	);
	expect(
		labels.get('tests/renderer/agent-control-tool-namespacing.test.ts'),
	).toBe('renderer/agent-control-tool-namespacing.test.ts');
});

test('the label grows only as far as it has to', () => {
	const labels = chipLabelsForPaths([
		'src/main/linear/index.ts',
		'src/main/storage/index.ts',
		'src/renderer/state/workspace/index.ts',
	]);

	expect(labels.get('src/main/linear/index.ts')).toBe('linear/index.ts');
	expect(labels.get('src/main/storage/index.ts')).toBe('storage/index.ts');
	expect(labels.get('src/renderer/state/workspace/index.ts')).toBe(
		'workspace/index.ts',
	);
});

test('a shared parent is skipped over until the segment that differs', () => {
	const labels = chipLabelsForPaths([
		'src/main/ipc/handlers/checkpoint.ts',
		'src/shared/ipc/handlers/checkpoint.ts',
	]);

	expect(labels.get('src/main/ipc/handlers/checkpoint.ts')).toBe(
		'main/ipc/handlers/checkpoint.ts',
	);
	expect(labels.get('src/shared/ipc/handlers/checkpoint.ts')).toBe(
		'shared/ipc/handlers/checkpoint.ts',
	);
});

test('a name shared by a root file and a nested one keeps the root bare', () => {
	const labels = chipLabelsForPaths(['index.ts', 'src/index.ts']);

	expect(labels.get('index.ts')).toBe('index.ts');
	expect(labels.get('src/index.ts')).toBe('src/index.ts');
});

test('a path outside the workspace keeps its leading slash', () => {
	const labels = chipLabelsForPaths(['/tmp/notes.md', 'docs/notes.md']);

	expect(labels.get('/tmp/notes.md')).toBe('tmp/notes.md');
	expect(labels.get('docs/notes.md')).toBe('docs/notes.md');
});

test('a repeated path is answered once rather than fighting itself', () => {
	const labels = chipLabelsForPaths(['src/app.ts', 'src/app.ts']);

	expect(labels.size).toBe(1);
	expect(labels.get('src/app.ts')).toBe('app.ts');
});
