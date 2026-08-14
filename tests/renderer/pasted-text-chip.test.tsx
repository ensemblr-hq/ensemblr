// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AttachmentChip } from '@/renderer/components/workbench-shell/conversation-panel/composer/attachment-chip';
import { ComposerNotices } from '@/renderer/components/workbench-shell/conversation-panel/composer/composer-notices';
import { PastedTextChip } from '@/renderer/components/workbench-shell/conversation-panel/composer/pasted-text-chip';
import type { ComposerStateApi } from '@/renderer/hooks/workbench-shell/composer/use-composer-state';
import { attachmentPreviewPath } from '@/renderer/lib/workbench/composer-attachments';
import type {
	ComposerAttachment,
	LinkedDirectory,
} from '@/renderer/types/workbench';
import { renderWithProviders } from './support/dom';

const LONG_PREVIEW = `function boom() {\n\tthrow new Error('kaboom');\n}`;

function pastedText(
	overrides: Partial<Extract<ComposerAttachment, { kind: 'pasted-text' }>> = {},
): Extract<ComposerAttachment, { kind: 'pasted-text' }> {
	return {
		id: 'wsfile:.context/attachments/ee33ff/pasted-text.txt',
		kind: 'pasted-text',
		label: 'pasted-text.txt',
		lineCount: 128,
		path: '.context/attachments/ee33ff/pasted-text.txt',
		preview: LONG_PREVIEW,
		...overrides,
	};
}

describe('pasted-text chip', () => {
	it('shows the preview and a pluralised line count instead of a bare filename', () => {
		const attachment = pastedText();
		renderWithProviders(
			<PastedTextChip
				lineCount={attachment.lineCount}
				onRemove={vi.fn()}
				preview={attachment.preview}
			/>,
		);

		expect(
			screen.getByText(LONG_PREVIEW, { collapseWhitespace: false }),
		).toBeInTheDocument();
		expect(screen.getByText('Pasted text · 128 lines')).toBeInTheDocument();
		expect(screen.queryByText('pasted-text.txt')).not.toBeInTheDocument();
	});

	it('uses the singular form for a one-line paste', () => {
		renderWithProviders(
			<PastedTextChip
				lineCount={1}
				onRemove={vi.fn()}
				preview={LONG_PREVIEW}
			/>,
		);

		expect(screen.getByText('Pasted text · 1 line')).toBeInTheDocument();
	});

	it('removes the attachment when the remove button is pressed', async () => {
		const onRemove = vi.fn();
		renderWithProviders(
			<PastedTextChip
				lineCount={128}
				onRemove={onRemove}
				preview={LONG_PREVIEW}
			/>,
		);

		await userEvent.click(
			screen.getByRole('button', { name: /Remove Pasted text/ }),
		);

		expect(onRemove).toHaveBeenCalledTimes(1);
	});

	it('opens the stored paste when the preview is pressed', async () => {
		const onActivate = vi.fn();
		renderWithProviders(
			<PastedTextChip
				lineCount={128}
				onActivate={onActivate}
				onRemove={vi.fn()}
				preview={LONG_PREVIEW}
			/>,
		);

		await userEvent.click(
			screen.getByRole('button', { name: /Open Pasted text/ }),
		);

		expect(onActivate).toHaveBeenCalledTimes(1);
	});
});

describe('attachment chip', () => {
	it('renders the plain chip for a workspace file, not the preview card', () => {
		renderWithProviders(
			<AttachmentChip
				attachment={{
					id: 'wsfile:src/app.ts',
					kind: 'workspace-file',
					label: 'app.ts',
					path: 'src/app.ts',
				}}
				onRemove={vi.fn()}
			/>,
		);

		expect(screen.getByText('app.ts')).toBeInTheDocument();
		expect(screen.queryByText(/Pasted text/)).not.toBeInTheDocument();
	});

	it('labels an issue chip with its reference rather than the document filename', () => {
		renderWithProviders(
			<AttachmentChip
				attachment={{
					id: 'issue:linear:ENG-106',
					kind: 'issue',
					label: 'ENG-106',
					path: '.context/attachments/aa11bb/linear-issue-eng-106.md',
					provider: 'linear',
				}}
				onRemove={vi.fn()}
			/>,
		);

		expect(screen.getByText('ENG-106')).toBeInTheDocument();
		expect(
			screen.queryByText('linear-issue-eng-106.md'),
		).not.toBeInTheDocument();
	});

	it('opens the file when given an activate handler', async () => {
		const onActivate = vi.fn();
		renderWithProviders(
			<AttachmentChip
				attachment={{
					id: 'wsfile:src/app.ts',
					kind: 'workspace-file',
					label: 'app.ts',
					path: 'src/app.ts',
				}}
				onActivate={onActivate}
				onRemove={vi.fn()}
			/>,
		);

		await userEvent.click(screen.getByRole('button', { name: 'Open app.ts' }));

		expect(onActivate).toHaveBeenCalledTimes(1);
	});

	it('stays inert without one, so the remove button is the only control', () => {
		renderWithProviders(
			<AttachmentChip
				attachment={{
					id: 'wsdir:src',
					kind: 'workspace-directory',
					label: 'src',
					path: 'src',
				}}
				onRemove={vi.fn()}
			/>,
		);

		expect(screen.getAllByRole('button')).toHaveLength(1);
		expect(screen.queryByRole('button', { name: /^Open/ })).toBeNull();
	});
});

describe('attachmentPreviewPath', () => {
	it('gives the repo-relative path for everything the preview can read', () => {
		expect(
			attachmentPreviewPath({
				id: 'wsfile:src/app.ts',
				kind: 'workspace-file',
				label: 'app.ts',
				path: 'src/app.ts',
			}),
		).toBe('src/app.ts');
		expect(attachmentPreviewPath(pastedText())).toBe(
			'.context/attachments/ee33ff/pasted-text.txt',
		);
		expect(
			attachmentPreviewPath({
				id: 'issue:github:#42',
				kind: 'issue',
				label: '#42',
				path: '.context/attachments/cc22dd/github-issue-42.md',
				provider: 'github',
			}),
		).toBe('.context/attachments/cc22dd/github-issue-42.md');
	});

	it('gives nothing for a directory or a file left outside the workspace', () => {
		expect(
			attachmentPreviewPath({
				id: 'wsdir:src',
				kind: 'workspace-directory',
				label: 'src',
				path: 'src',
			}),
		).toBeNull();
		expect(
			attachmentPreviewPath({
				absolutePath: '/Users/me/Downloads/huge.zip',
				id: 'external:/Users/me/Downloads/huge.zip',
				kind: 'external-file',
				label: 'huge.zip',
				sizeBytes: 20_000_000,
			}),
		).toBeNull();
	});
});

const VAULT: LinkedDirectory = {
	name: 'Vault 111',
	path: '/Users/me/Documents/Obsidian/Vault 111',
};

function renderNotices(
	linked: {
		linkedDirectories?: readonly LinkedDirectory[];
		pendingLinkedDirectories?: readonly LinkedDirectory[];
		unlinkDirectory?: (path: string) => void;
	} = {},
) {
	const unlinkDirectory = linked.unlinkDirectory ?? vi.fn();
	const state = {
		attachmentError: null,
		attachments: [],
		followUpQueue: [],
		hasChips: false,
		linkedDirectories: linked.linkedDirectories ?? [],
		pendingLinkedDirectories: linked.pendingLinkedDirectories ?? [],
		sendIntent: 'send',
		unlinkDirectory,
	} as unknown as ComposerStateApi;
	renderWithProviders(
		<ComposerNotices dictationFailure={null} state={state} />,
	);
	return { unlinkDirectory };
}

describe('linked-directory chip', () => {
	it('shows the name over the absolute path it granted', () => {
		renderNotices({ linkedDirectories: [VAULT] });

		expect(screen.getByText('Vault 111')).toBeInTheDocument();
		expect(screen.getByText(VAULT.path)).toBeInTheDocument();
	});

	it('stays above the draft, since a link is not part of any one message', () => {
		renderNotices({ linkedDirectories: [VAULT] });

		expect(screen.getByText('Vault 111')).toBeInTheDocument();
	});

	it('unlinks by path when the remove button is pressed', async () => {
		const { unlinkDirectory } = renderNotices({ linkedDirectories: [VAULT] });

		await userEvent.click(
			screen.getByRole('button', { name: /Remove Vault 111/ }),
		);

		expect(unlinkDirectory).toHaveBeenCalledWith(VAULT.path);
	});

	it('warns only while a directory is linked after the session opened', () => {
		renderNotices({ linkedDirectories: [VAULT] });

		expect(screen.queryByText(/from the next session/)).not.toBeInTheDocument();
	});

	it('explains that a directory linked mid-session is not readable yet', () => {
		renderNotices({
			linkedDirectories: [VAULT],
			pendingLinkedDirectories: [VAULT],
		});

		expect(screen.getByText(/from the next session/)).toBeInTheDocument();
	});
});
