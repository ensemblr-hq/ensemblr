// @vitest-environment happy-dom

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { ReviewFilePreviewOpenerProvider } from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { AllFilesList } from '../../src/renderer/components/workbench-shell/review-files/all-files-list';
import { ReviewFileList } from '../../src/renderer/components/workbench-shell/review-files/review-file-list';
import { useComposerAttachmentInbox } from '../../src/renderer/state/composer';
import type {
	ReviewFileSummary,
	WorkspaceFileSummary,
} from '../../src/renderer/types/workbench';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	installLocalStorage,
	renderWithProviders,
} from './support/dom';

const { toastError, toastSuccess } = vi.hoisted(() => ({
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({
	toast: { error: toastError, success: toastSuccess },
}));

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

const PATCH = ['@@ -1 +1 @@', '-old', '+new'].join('\n');
const DOCUMENT_PATH = '.context/attachments/ab12cd/diff-src-app-ts.md';

// Folders start collapsed, so the file the menu is opened against sits at the
// root; the folder row is what the directory case needs.
const treeFiles: WorkspaceFileSummary[] = [
	{ id: 'src', kind: 'directory', name: 'src', path: 'src' },
	{ id: 'src/app.ts', kind: 'file', name: 'app.ts', path: 'src/app.ts' },
	{ id: 'index.ts', kind: 'file', name: 'index.ts', path: 'index.ts' },
];

const changedFiles: ReviewFileSummary[] = [
	{
		additions: 1,
		contentId: null,
		deletions: 1,
		id: 'src/app.ts',
		path: 'src/app.ts',
		status: 'modified',
	},
];

/**
 * Reports what the composer inbox is holding for a workspace root, so a test can
 * assert what a menu queued without reaching into the private atom.
 */
function AttachmentProbe({ workspaceCwd }: { workspaceCwd: string }) {
	const { pending } = useComposerAttachmentInbox('chat-1', workspaceCwd);
	return (
		<ul data-testid='queued'>
			{pending.map((attachment) => (
				<li
					key={attachment.id}
				>{`${attachment.kind}|${attachment.label}|${attachment.id}`}</li>
			))}
		</ul>
	);
}

/** The attachment entries the probe is currently reporting. */
function queuedEntries(): string[] {
	return Array.from(
		screen.getByTestId('queued').querySelectorAll('li'),
		(item) => item.textContent ?? '',
	);
}

/** Right-clicks a row to open whichever shared context menu owns it. */
function openRowMenu(path: string) {
	const row = document.querySelector<HTMLElement>(`[data-row-path="${path}"]`);
	if (!row) {
		throw new Error(`No row for ${path}`);
	}
	fireEvent.contextMenu(row);
}

beforeEach(() => {
	toastError.mockClear();
	toastSuccess.mockClear();
	installLocalStorage();
	installEnsemblrApi({
		getWorkspaceFileDiff: async () => ({
			isTruncated: false,
			patch: PATCH,
			path: 'src/app.ts',
		}),
		listWorkspaceOpenTargets: async () => ({ targets: [] }),
		readWorkspaceDirectory: async () => ({ entries: [] }),
		writeWorkspaceFileAttachment: async () => ({
			file: { kind: 'file', name: 'diff-src-app-ts.md', path: DOCUMENT_PATH },
		}),
	});
	return () => clearEnsemblrApi();
});

test('the files tree attaches a file row to the chat as a workspace-file chip', async () => {
	renderWithProviders(
		<ReviewFilePreviewOpenerProvider value={vi.fn()}>
			<AllFilesList
				files={treeFiles}
				workspaceCwd='/ws/file'
				workspaceId='w1'
			/>
			<AttachmentProbe workspaceCwd='/ws/file' />
		</ReviewFilePreviewOpenerProvider>,
	);

	openRowMenu('index.ts');
	fireEvent.click(
		await screen.findByRole('menuitem', { name: 'Attach to chat' }),
	);

	await waitFor(() => {
		expect(queuedEntries()).toEqual([
			'workspace-file|index.ts|wsfile:index.ts',
		]);
	});
});

// A folder chip is what the composer already sends for an `@src` mention, so the
// tree's own folder rows have to produce the same thing.
test('the files tree attaches a folder row as a workspace-directory chip', async () => {
	renderWithProviders(
		<ReviewFilePreviewOpenerProvider value={vi.fn()}>
			<AllFilesList
				files={treeFiles}
				workspaceCwd='/ws/folder'
				workspaceId='w1'
			/>
			<AttachmentProbe workspaceCwd='/ws/folder' />
		</ReviewFilePreviewOpenerProvider>,
	);

	openRowMenu('src');
	fireEvent.click(
		await screen.findByRole('menuitem', { name: 'Attach to chat' }),
	);

	await waitFor(() => {
		expect(queuedEntries()).toEqual(['workspace-directory|src|wsdir:src']);
	});
});

// The patch has no file of its own, so it is written out as a document first and
// the chip points at that rather than pasting the diff into the draft.
test('the changes list attaches a row diff as a file-diff chip', async () => {
	renderWithProviders(
		<>
			<ReviewFileList
				files={changedFiles}
				onDiscardFile={vi.fn()}
				viewMode='list'
				workspaceCwd='/ws/diff'
				workspaceId='w1'
			/>
			<AttachmentProbe workspaceCwd='/ws/diff' />
		</>,
	);

	openRowMenu('src/app.ts');
	fireEvent.click(
		await screen.findByRole('menuitem', { name: 'Attach diff to chat' }),
	);

	await waitFor(() => {
		expect(queuedEntries()).toEqual([
			`file-diff|app.ts|file-diff:${DOCUMENT_PATH}`,
		]);
	});
});

test('a row with no diff queues nothing', async () => {
	installEnsemblrApi({
		getWorkspaceFileDiff: async () => ({
			isTruncated: false,
			patch: '',
			path: 'src/app.ts',
		}),
		listWorkspaceOpenTargets: async () => ({ targets: [] }),
		readWorkspaceDirectory: async () => ({ entries: [] }),
		writeWorkspaceFileAttachment: async () => ({
			file: { kind: 'file', name: 'diff-src-app-ts.md', path: DOCUMENT_PATH },
		}),
	});
	renderWithProviders(
		<>
			<ReviewFileList
				files={changedFiles}
				onDiscardFile={vi.fn()}
				viewMode='list'
				workspaceCwd='/ws/empty'
				workspaceId='w1'
			/>
			<AttachmentProbe workspaceCwd='/ws/empty' />
		</>,
	);

	openRowMenu('src/app.ts');
	fireEvent.click(
		await screen.findByRole('menuitem', { name: 'Attach diff to chat' }),
	);

	await waitFor(() => {
		expect(toastError).toHaveBeenCalledWith('app.ts has no diff to attach.');
	});
	expect(queuedEntries()).toEqual([]);
});

// `openTargets` is null until its query resolves and stays empty on a machine
// with nothing detected, so the open-in submenu and the copy-path item both
// render nothing — an unconditional separator ahead of them stacks two dividers
// against the discard item.
test('the changes menu draws no empty separator run without open targets', async () => {
	renderWithProviders(
		<ReviewFileList
			files={changedFiles}
			onDiscardFile={vi.fn()}
			viewMode='list'
			workspaceCwd='/ws/separators'
			workspaceId='w1'
		/>,
	);

	openRowMenu('src/app.ts');
	await screen.findByRole('menuitem', { name: 'Attach diff to chat' });

	expect(screen.getAllByRole('separator')).toHaveLength(1);
});

// A path git refused is not an unchanged file. Reporting the typed failure as
// "no diff to attach" tells the user the one thing that is not true.
test('a row whose diff failed reports the failure, not an empty diff', async () => {
	installEnsemblrApi({
		getWorkspaceFileDiff: async () => ({
			error: { code: 'invalid-path', message: 'Path escapes the workspace.' },
			path: 'src/app.ts',
		}),
		listWorkspaceOpenTargets: async () => ({ targets: [] }),
		readWorkspaceDirectory: async () => ({ entries: [] }),
		writeWorkspaceFileAttachment: async () => ({
			file: { kind: 'file', name: 'diff-src-app-ts.md', path: DOCUMENT_PATH },
		}),
	});
	renderWithProviders(
		<>
			<ReviewFileList
				files={changedFiles}
				onDiscardFile={vi.fn()}
				viewMode='list'
				workspaceCwd='/ws/failed'
				workspaceId='w1'
			/>
			<AttachmentProbe workspaceCwd='/ws/failed' />
		</>,
	);

	openRowMenu('src/app.ts');
	fireEvent.click(
		await screen.findByRole('menuitem', { name: 'Attach diff to chat' }),
	);

	await waitFor(() => {
		expect(toastError).toHaveBeenCalledTimes(1);
	});
	expect(toastError.mock.calls[0]?.[0]).not.toContain('no diff to attach');
	expect(queuedEntries()).toEqual([]);
});
