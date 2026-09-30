// @vitest-environment happy-dom

/**
 * The All files tab re-ran its whole tree model — the lazy directory loader, the
 * flattened rows, the virtualizer — every time the review panel above it
 * rendered, although its props (the workspace file list, whose identity the live
 * model already keeps stable, and two strings) had not moved. The list is now
 * memoized, so an equal render of the panel skips the tree entirely.
 */

import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { AllFilesList } from '../../../src/renderer/components/workbench-shell/review-files/all-files-list';
import type { WorkspaceFileSummary } from '../../../src/renderer/types/workbench';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	installLocalStorage,
	renderWithProviders,
} from '../support/dom';

const treeModel = vi.hoisted(() => ({ calls: 0 }));

vi.mock(
	'@/renderer/hooks/workbench-shell/review-files/use-workspace-file-tree',
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import('@/renderer/hooks/workbench-shell/review-files/use-workspace-file-tree')
			>();
		return {
			...actual,
			useWorkspaceFileTree: (
				...args: Parameters<typeof actual.useWorkspaceFileTree>
			) => {
				treeModel.calls += 1;
				return actual.useWorkspaceFileTree(...args);
			},
		};
	},
);

const FILES: WorkspaceFileSummary[] = [
	{ id: 'src/a.ts', kind: 'file', name: 'a.ts', path: 'src/a.ts' },
	{ id: 'src/b.ts', kind: 'file', name: 'b.ts', path: 'src/b.ts' },
];

/** Mounts the list and lets its queries settle, returning the tree-model calls so far. */
async function mountSettled(files: WorkspaceFileSummary[]) {
	const view = renderWithProviders(
		<AllFilesList files={files} workspaceCwd='/tmp/ws' workspaceId='w1' />,
	);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	return { callsAfterMount: treeModel.calls, view };
}

beforeEach(() => {
	treeModel.calls = 0;
	installLocalStorage();
	installEnsemblrApi({
		listWorkspaceOpenTargets: async () => ({ targets: [] }),
		readWorkspaceDirectory: async () => ({ entries: [] }),
	});
});

afterEach(() => {
	clearEnsemblrApi();
});

describe('AllFilesList', () => {
	test('skips its tree model when re-rendered with the same props', async () => {
		const { callsAfterMount, view } = await mountSettled(FILES);

		view.rerender(
			<AllFilesList files={FILES} workspaceCwd='/tmp/ws' workspaceId='w1' />,
		);
		view.rerender(
			<AllFilesList files={FILES} workspaceCwd='/tmp/ws' workspaceId='w1' />,
		);

		expect(treeModel.calls).toBe(callsAfterMount);
	});

	test('runs its tree model again when the file list changes', async () => {
		const { callsAfterMount, view } = await mountSettled(FILES);

		view.rerender(
			<AllFilesList
				files={[
					...FILES,
					{ id: 'src/c.ts', kind: 'file', name: 'c.ts', path: 'src/c.ts' },
				]}
				workspaceCwd='/tmp/ws'
				workspaceId='w1'
			/>,
		);

		expect(treeModel.calls).toBeGreaterThan(callsAfterMount);
	});

	test('runs its tree model again for another workspace', async () => {
		const { callsAfterMount, view } = await mountSettled(FILES);

		view.rerender(
			<AllFilesList files={FILES} workspaceCwd='/tmp/other' workspaceId='w2' />,
		);

		expect(treeModel.calls).toBeGreaterThan(callsAfterMount);
	});
});
