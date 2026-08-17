// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
	ReviewFilePreviewOpenerProvider,
	WorkspaceFileDiffOpenerProvider,
} from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { ReviewFileList } from '../../src/renderer/components/workbench-shell/review-files/review-file-list';
import type { ReviewFileSummary } from '../../src/renderer/types/workbench';
import type { ChangesViewMode } from '../../src/renderer/types/workbench-shell';
import type { WorkspaceGitDiffScope } from '../../src/shared/ipc/contracts/workspace-git';
import { installLocalStorage, renderWithProviders } from './support/dom';

const imageFile: ReviewFileSummary = {
	additions: 0,
	contentId: null,
	deletions: 0,
	id: 'img',
	path: 'assets/logo.png',
	status: 'modified',
};

const sourceFile: ReviewFileSummary = {
	additions: 4,
	contentId: null,
	deletions: 1,
	id: 'src',
	path: 'src/main/index.ts',
	status: 'modified',
};

const deletedImageFile: ReviewFileSummary = {
	additions: 0,
	contentId: null,
	deletions: 0,
	id: 'gone',
	path: 'assets/removed.png',
	status: 'deleted',
};

function renderChanges(options: {
	diffScope?: WorkspaceGitDiffScope;
	files?: ReviewFileSummary[];
	viewMode?: ChangesViewMode;
}) {
	const openDiff = vi.fn();
	const openPreview = vi.fn();

	renderWithProviders(
		<WorkspaceFileDiffOpenerProvider value={openDiff}>
			<ReviewFilePreviewOpenerProvider value={openPreview}>
				<ReviewFileList
					{...(options.diffScope ? { diffScope: options.diffScope } : {})}
					files={options.files ?? [imageFile, sourceFile, deletedImageFile]}
					onDiscardFile={() => {}}
					viewMode={options.viewMode ?? 'list'}
					workspaceCwd='/tmp/ws'
					workspaceId='w1'
				/>
			</ReviewFilePreviewOpenerProvider>
		</WorkspaceFileDiffOpenerProvider>,
	);

	return { openDiff, openPreview };
}

function openRowMenu(path: string) {
	const row = document.querySelector<HTMLElement>(`[data-row-path="${path}"]`);
	if (!row) {
		throw new Error(`No changed-file row for ${path}`);
	}
	fireEvent.contextMenu(row);
}

describe('ReviewFileList image routing', () => {
	beforeEach(() => {
		installLocalStorage();
	});

	test('opens a changed image in the image preview instead of a binary diff', () => {
		const { openDiff, openPreview } = renderChanges({});

		fireEvent.click(
			screen.getByRole('button', { name: 'Open assets/logo.png' }),
		);

		expect(openPreview).toHaveBeenCalledWith('assets/logo.png', undefined);
		expect(openDiff).not.toHaveBeenCalled();
	});

	test('still opens the diff for a source file', () => {
		const { openDiff, openPreview } = renderChanges({});

		fireEvent.click(
			screen.getByRole('button', { name: 'Open src/main/index.ts' }),
		);

		expect(openDiff).toHaveBeenCalledWith(
			'src/main/index.ts',
			undefined,
			undefined,
		);
		expect(openPreview).not.toHaveBeenCalled();
	});

	test('keeps the diff for an image the workspace no longer holds', () => {
		const { openDiff, openPreview } = renderChanges({});

		fireEvent.click(
			screen.getByRole('button', { name: 'Open assets/removed.png' }),
		);

		expect(openDiff).toHaveBeenCalledWith(
			'assets/removed.png',
			undefined,
			undefined,
		);
		expect(openPreview).not.toHaveBeenCalled();
	});

	test('keeps the diff at a commit scope, whose image is not the working-tree file', () => {
		const scope: WorkspaceGitDiffScope = {
			commitHash: 'abc123',
			kind: 'commit',
		};
		const { openDiff, openPreview } = renderChanges({ diffScope: scope });

		fireEvent.click(
			screen.getByRole('button', { name: 'Open assets/logo.png' }),
		);

		expect(openDiff).toHaveBeenCalledWith('assets/logo.png', scope, undefined);
		expect(openPreview).not.toHaveBeenCalled();
	});

	test('previews the image at a branch scope, whose new side is the working tree', () => {
		const scope: WorkspaceGitDiffScope = {
			baseRef: 'origin/master',
			kind: 'branch',
		};
		const { openDiff, openPreview } = renderChanges({ diffScope: scope });

		fireEvent.click(
			screen.getByRole('button', { name: 'Open assets/logo.png' }),
		);

		expect(openPreview).toHaveBeenCalledWith('assets/logo.png', undefined);
		expect(openDiff).not.toHaveBeenCalled();
	});

	test('routes the same way from a folder-tree row', () => {
		const { openDiff, openPreview } = renderChanges({ viewMode: 'folders' });

		fireEvent.click(
			screen.getByRole('button', { name: 'Open assets/logo.png' }),
		);
		expect(openPreview).toHaveBeenCalledWith('assets/logo.png', undefined);

		fireEvent.click(
			screen.getByRole('button', { name: 'Open src/main/index.ts' }),
		);
		expect(openDiff).toHaveBeenCalledWith(
			'src/main/index.ts',
			undefined,
			undefined,
		);
	});

	test('the right-click View item previews a changed image', async () => {
		const { openDiff, openPreview } = renderChanges({});

		openRowMenu('assets/logo.png');
		fireEvent.click(await screen.findByRole('menuitem', { name: 'View' }));

		expect(openPreview).toHaveBeenCalledWith('assets/logo.png', undefined);
		expect(openDiff).not.toHaveBeenCalled();
	});

	test('the right-click View item still opens a source file diff', async () => {
		const { openDiff, openPreview } = renderChanges({});

		openRowMenu('src/main/index.ts');
		fireEvent.click(await screen.findByRole('menuitem', { name: 'View' }));

		expect(openDiff).toHaveBeenCalledWith(
			'src/main/index.ts',
			undefined,
			undefined,
		);
		expect(openPreview).not.toHaveBeenCalled();
	});

	test('drops the openers entirely when no diff opener is mounted', () => {
		const openPreview = vi.fn();

		renderWithProviders(
			<ReviewFilePreviewOpenerProvider value={openPreview}>
				<ReviewFileList
					files={[imageFile, sourceFile]}
					onDiscardFile={() => {}}
					viewMode='list'
					workspaceCwd='/tmp/ws'
					workspaceId='w1'
				/>
			</ReviewFilePreviewOpenerProvider>,
		);

		fireEvent.click(
			screen.getByRole('button', { name: 'Open assets/logo.png' }),
		);

		expect(openPreview).not.toHaveBeenCalled();
	});
});
