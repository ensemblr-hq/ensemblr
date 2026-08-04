// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { ReviewFilePreviewOpenerProvider } from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { AllFilesList } from '../../src/renderer/components/workbench-shell/review-files/all-files-list';
import type { WorkspaceFileSummary } from '../../src/renderer/types/workbench';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	installLocalStorage,
	renderWithProviders,
} from './support/dom';

// happy-dom reports every element as 0×0, so the real virtualizer measures an
// empty viewport and mounts no rows. Render the whole (tiny) fixture list.
vi.mock('@tanstack/react-virtual', () => ({
	useVirtualizer: ({ count }: { count: number }) => ({
		getTotalSize: () => count * 28,
		getVirtualItems: () =>
			Array.from({ length: count }, (_unused, index) => ({
				index,
				key: index,
				size: 28,
				start: index * 28,
			})),
		scrollToIndex: () => undefined,
	}),
}));

const FILE_PATH = 'index.ts';

const files: WorkspaceFileSummary[] = [
	{ id: FILE_PATH, kind: 'file', name: 'index.ts', path: FILE_PATH },
];

/** Renders the workspace file tree with a spy preview opener. */
function renderFileTree() {
	const openFilePreview = vi.fn();

	renderWithProviders(
		<ReviewFilePreviewOpenerProvider value={openFilePreview}>
			<AllFilesList files={files} workspaceCwd='/tmp/ws' workspaceId='w1' />
		</ReviewFilePreviewOpenerProvider>,
	);

	return { openFilePreview };
}

/** Right-clicks a tree row to open the shared file-tree context menu. */
function openRowMenu(path: string) {
	const row = document.querySelector<HTMLElement>(`[data-row-path="${path}"]`);
	if (!row) {
		throw new Error(`No file-tree row for ${path}`);
	}
	fireEvent.contextMenu(row);
}

beforeEach(() => {
	installLocalStorage();
	installEnsemblrApi({
		listWorkspaceOpenTargets: async () => ({ targets: [] }),
		readWorkspaceDirectory: async () => ({ entries: [] }),
	});
	return () => clearEnsemblrApi();
});

test('a single click opens a tree file into the preview slot', () => {
	const { openFilePreview } = renderFileTree();

	fireEvent.click(screen.getByRole('treeitem', { name: /index\.ts/ }));

	expect(openFilePreview).toHaveBeenCalledWith(FILE_PATH);
});

test('a double click asks for a permanent tab instead', () => {
	const { openFilePreview } = renderFileTree();

	fireEvent.doubleClick(screen.getByRole('treeitem', { name: /index\.ts/ }));

	expect(openFilePreview).toHaveBeenCalledWith(FILE_PATH, { preview: false });
});

test('the right-click Keep open item asks for a permanent tab', async () => {
	const { openFilePreview } = renderFileTree();

	openRowMenu(FILE_PATH);
	fireEvent.click(await screen.findByRole('menuitem', { name: 'Keep open' }));

	expect(openFilePreview).toHaveBeenCalledWith(FILE_PATH, { preview: false });
});
