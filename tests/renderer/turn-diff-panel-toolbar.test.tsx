// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr-queries';
import { TurnDiffPanel } from '../../src/renderer/components/workbench-shell/conversation-panel/turn-diff-panel';
import type { ComputeTurnDiffResult } from '../../src/shared/ipc/contracts/checkpoint';
import {
	createTestQueryClient,
	installLocalStorage,
	renderWithProviders,
} from './support/dom';

const turnId = 'turn-1';

const patch = [
	'diff --git a/docs/notes.md b/docs/notes.md',
	'--- a/docs/notes.md',
	'+++ b/docs/notes.md',
	'@@ -1,2 +1,2 @@',
	' intro',
	'-old line',
	'+new line',
	'diff --git a/src/app.ts b/src/app.ts',
	'--- a/src/app.ts',
	'+++ b/src/app.ts',
	'@@ -1,2 +1,2 @@',
	' header',
	'-const a = 1;',
	'+const a = 2;',
	'',
].join('\n');

const turnDiff: ComputeTurnDiffResult = {
	checkpoint: {
		agentSessionId: 'session-1',
		createdAt: '2026-09-14T12:00:00.000Z',
		gitHash: 'abc123',
		gitRef: 'refs/ensemblr/checkpoints/turn-1',
		id: 'checkpoint-1',
		label: 'fix create PR',
		turnId,
		workspaceId: 'workspace-1',
	},
	files: [
		{ additions: 1, deletions: 1, path: 'docs/notes.md', status: 'modified' },
		{ additions: 1, deletions: 1, path: 'src/app.ts', status: 'modified' },
	],
	ok: true,
	patch,
};

function renderTurnDiff() {
	const client = createTestQueryClient();
	client.setQueryData(ensemblrQueryKeys.turnDiff(turnId), turnDiff);
	return renderWithProviders(<TurnDiffPanel turnId={turnId} />, { client });
}

beforeEach(() => {
	installLocalStorage();
});

test('hoists one copy of the display toggles into the panel header', () => {
	renderTurnDiff();

	expect(screen.getAllByRole('button', { name: 'Split view' })).toHaveLength(1);
	expect(
		screen.getAllByRole('button', { name: 'Show hidden characters' }),
	).toHaveLength(1);
	expect(
		screen.getAllByRole('button', { name: 'Enable word wrap' }),
	).toHaveLength(1);
});

test('drops the diff/file switch, which has no full file source to reach', () => {
	renderTurnDiff();

	expect(screen.queryByRole('button', { name: 'Diff' })).toBeNull();
	expect(screen.queryByRole('button', { name: 'File' })).toBeNull();
});

test('keeps the changed-file rows and a header per rendered file', () => {
	renderTurnDiff();

	expect(screen.getByText('2 files')).toBeInTheDocument();
	expect(screen.getByText('docs/notes.md')).toBeInTheDocument();
	expect(screen.getByText('src/app.ts')).toBeInTheDocument();
	expect(screen.getAllByText('docs/')).toHaveLength(1);
	expect(screen.getAllByText('notes.md')).toHaveLength(1);
	expect(screen.getAllByText('src/')).toHaveLength(1);
	expect(screen.getAllByText('app.ts')).toHaveLength(1);
});
