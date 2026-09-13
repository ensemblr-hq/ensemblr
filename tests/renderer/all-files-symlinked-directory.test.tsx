// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { ReviewFilePreviewOpenerProvider } from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { AllFilesList } from '../../src/renderer/components/workbench-shell/review-files/all-files-list';
import { AllFilesSearchDialog } from '../../src/renderer/components/workbench-shell/review-files/all-files-search-dialog';
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

const FOLDER_LINK = 'linked-packages';
const FILE_LINK = 'linked-readme.md';
/**
 * A real folder, present only as the parent of a nested file. `buildFileTree`
 * synthesizes its row, so the listing holds no entry for it — which is why the
 * row's own kind, not a lookup, has to classify it.
 */
const SYNTHESIZED_FOLDER = 'packages';

const files: WorkspaceFileSummary[] = [
	{
		id: FOLDER_LINK,
		kind: 'file',
		name: FOLDER_LINK,
		path: FOLDER_LINK,
		symlinkTargetKind: 'directory',
	},
	{
		id: FILE_LINK,
		kind: 'file',
		name: FILE_LINK,
		path: FILE_LINK,
		symlinkTargetKind: 'file',
	},
	{
		id: `${SYNTHESIZED_FOLDER}/index.ts`,
		kind: 'file',
		name: 'index.ts',
		path: `${SYNTHESIZED_FOLDER}/index.ts`,
	},
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

/** A copy-path utility target, the one open-in entry that needs no installed app. */
const COPY_PATH_TARGET = {
	behavior: 'copy-path',
	iconName: 'clipboard',
	id: 'copy-path',
	installed: true,
	kind: 'utility',
	label: 'Copy path',
	numberShortcutLabel: '1',
};

/** Finds a tree row by the path it carries, regardless of its label. */
function row(path: string): HTMLElement {
	const element = document.querySelector<HTMLElement>(
		`[data-row-path="${path}"]`,
	);
	if (!element) {
		throw new Error(`No file-tree row for ${path}`);
	}
	return element;
}

beforeEach(() => {
	installLocalStorage();
	installEnsemblrApi({
		listWorkspaceOpenTargets: async () => ({ targets: [] }),
		readWorkspaceDirectory: async () => ({ entries: [] }),
	});
	return () => clearEnsemblrApi();
});

test('clicking a symlink to a directory opens no preview', () => {
	const { openFilePreview } = renderFileTree();

	fireEvent.click(row(FOLDER_LINK));
	fireEvent.doubleClick(row(FOLDER_LINK));

	expect(openFilePreview).not.toHaveBeenCalled();
	expect(row(FOLDER_LINK)).toHaveAttribute('aria-disabled', 'true');
});

test('a symlink to a file still opens like any other row', () => {
	const { openFilePreview } = renderFileTree();

	fireEvent.click(row(FILE_LINK));

	expect(openFilePreview).toHaveBeenCalledWith(FILE_LINK);
});

test('the right-click menu drops View and Keep open for a directory link', async () => {
	renderFileTree();

	fireEvent.contextMenu(row(FOLDER_LINK));

	expect(
		await screen.findByRole('menuitem', { name: 'Attach to chat' }),
	).toBeInTheDocument();
	expect(screen.queryByRole('menuitem', { name: 'View' })).toBeNull();
	expect(screen.queryByRole('menuitem', { name: 'Keep open' })).toBeNull();
});

/** Renders the tree with a spy open-in bridge and returns the invoke spy. */
function renderFileTreeWithOpenTargets() {
	const openWorkspaceInTarget = vi.fn(async () => ({ ok: true }));
	clearEnsemblrApi();
	installEnsemblrApi({
		listWorkspaceOpenTargets: async () => ({ targets: [COPY_PATH_TARGET] }),
		openWorkspaceInTarget,
		readWorkspaceDirectory: async () => ({ entries: [] }),
	});
	renderFileTree();

	return { openWorkspaceInTarget };
}

test('a directory link stays a file for every action but View', async () => {
	const { openWorkspaceInTarget } = renderFileTreeWithOpenTargets();

	fireEvent.contextMenu(row(FOLDER_LINK));
	fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy path' }));

	// The link is a leaf entry, so "Open in" must act on the link itself rather
	// than on the directory behind it — the kind the row reports is what decides.
	expect(openWorkspaceInTarget).toHaveBeenCalledWith({
		relativePath: FOLDER_LINK,
		relativePathKind: 'file',
		targetId: 'copy-path',
		workspaceId: 'w1',
	});
});

test('a synthesized folder row is still reported as a directory', async () => {
	const { openWorkspaceInTarget } = renderFileTreeWithOpenTargets();

	fireEvent.contextMenu(row(SYNTHESIZED_FOLDER));
	fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy path' }));

	expect(openWorkspaceInTarget).toHaveBeenCalledWith({
		relativePath: SYNTHESIZED_FOLDER,
		relativePathKind: 'directory',
		targetId: 'copy-path',
		workspaceId: 'w1',
	});
});

test('a synthesized folder row gets neither View nor Keep open', async () => {
	renderFileTree();

	fireEvent.contextMenu(row(SYNTHESIZED_FOLDER));

	expect(
		await screen.findByRole('menuitem', { name: 'Attach to chat' }),
	).toBeInTheDocument();
	expect(screen.queryByRole('menuitem', { name: 'View' })).toBeNull();
	expect(screen.queryByRole('menuitem', { name: 'Keep open' })).toBeNull();
});

test('the search dialog lists only rows the preview can open', () => {
	renderWithProviders(
		<ReviewFilePreviewOpenerProvider value={vi.fn()}>
			<AllFilesSearchDialog files={files} onOpenChange={vi.fn()} open={true} />
		</ReviewFilePreviewOpenerProvider>,
	);

	expect(screen.getByRole('option', { name: /linked-readme/ })).toBeVisible();
	expect(screen.queryByRole('option', { name: /linked-packages/ })).toBeNull();
});
