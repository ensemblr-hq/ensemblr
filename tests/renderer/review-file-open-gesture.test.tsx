// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import {
	ReviewFilePreviewOpenerProvider,
	WorkspaceFileDiffOpenerProvider,
} from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { ReviewFileList } from '../../src/renderer/components/workbench-shell/review-files/review-file-list';
import type { ReviewFileSummary } from '../../src/renderer/types/workbench';
import { installLocalStorage, renderWithProviders } from './support/dom';

const sourceFile: ReviewFileSummary = {
	additions: 4,
	deletions: 1,
	id: 'src',
	path: 'src/main/index.ts',
	status: 'modified',
};

/**
 * Renders the changed-file list with spy openers.
 * @returns The diff opener spy the row gestures drive
 */
function renderChangedFiles() {
	const openDiff = vi.fn();

	renderWithProviders(
		<WorkspaceFileDiffOpenerProvider value={openDiff}>
			<ReviewFilePreviewOpenerProvider value={vi.fn()}>
				<ReviewFileList
					files={[sourceFile]}
					onDiscardFile={() => {}}
					viewMode='list'
					workspaceId='w1'
				/>
			</ReviewFilePreviewOpenerProvider>
		</WorkspaceFileDiffOpenerProvider>,
	);

	return { openDiff };
}

/** Right-clicks a changed-file row to open the shared changes context menu. */
function openRowMenu(path: string) {
	const row = document.querySelector<HTMLElement>(`[data-row-path="${path}"]`);
	if (!row) {
		throw new Error(`No changed-file row for ${path}`);
	}
	fireEvent.contextMenu(row);
}

beforeEach(() => {
	installLocalStorage();
});

test('a single click opens a changed file into the preview slot', () => {
	const { openDiff } = renderChangedFiles();

	fireEvent.click(
		screen.getByRole('button', { name: 'Open src/main/index.ts' }),
	);

	expect(openDiff).toHaveBeenCalledWith(
		'src/main/index.ts',
		undefined,
		undefined,
	);
});

test('a double click asks for a permanent tab instead', () => {
	const { openDiff } = renderChangedFiles();

	fireEvent.doubleClick(
		screen.getByRole('button', { name: 'Open src/main/index.ts' }),
	);

	expect(openDiff).toHaveBeenCalledWith('src/main/index.ts', undefined, {
		preview: false,
	});
});

test('the right-click Keep open item asks for a permanent tab', async () => {
	const { openDiff } = renderChangedFiles();

	openRowMenu('src/main/index.ts');
	fireEvent.click(await screen.findByRole('menuitem', { name: 'Keep open' }));

	expect(openDiff).toHaveBeenCalledWith('src/main/index.ts', undefined, {
		preview: false,
	});
});

test('the right-click View item still opens into the preview slot', async () => {
	const { openDiff } = renderChangedFiles();

	openRowMenu('src/main/index.ts');
	fireEvent.click(await screen.findByRole('menuitem', { name: 'View' }));

	expect(openDiff).toHaveBeenCalledWith(
		'src/main/index.ts',
		undefined,
		undefined,
	);
});
