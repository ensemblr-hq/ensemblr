// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ComposerNotices } from '@/renderer/components/workbench-shell/conversation-panel/composer/composer-notices';
import type { ComposerStateApi } from '@/renderer/hooks/workbench-shell/composer/use-composer-state';
import type {
	ComposerAttachment,
	LinkedDirectory,
} from '@/renderer/types/workbench';
import { renderWithProviders } from './support/dom';

const LONG_PREVIEW = `function boom() {\n\tthrow new Error('kaboom');\n}`;

function pastedText(
	overrides: Partial<Extract<ComposerAttachment, { kind: 'pasted-text' }>> = {},
): ComposerAttachment {
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

function renderNotices(
	attachments: readonly ComposerAttachment[],
	removeAttachment = vi.fn(),
	linked: {
		linkedDirectories?: readonly LinkedDirectory[];
		pendingLinkedDirectories?: readonly LinkedDirectory[];
		unlinkDirectory?: (path: string) => void;
	} = {},
) {
	const unlinkDirectory = linked.unlinkDirectory ?? vi.fn();
	const state = {
		attachmentError: null,
		attachments,
		blockedNotice: false,
		hasChips: attachments.length > 0,
		linkedDirectories: linked.linkedDirectories ?? [],
		pendingLinkedDirectories: linked.pendingLinkedDirectories ?? [],
		removeAttachment,
		unlinkDirectory,
	} as unknown as ComposerStateApi;
	renderWithProviders(<ComposerNotices state={state} />);
	return { removeAttachment, unlinkDirectory };
}

describe('pasted-text chip', () => {
	it('shows the preview and a pluralised line count instead of a bare filename', () => {
		renderNotices([pastedText()]);

		expect(
			screen.getByText(LONG_PREVIEW, { collapseWhitespace: false }),
		).toBeInTheDocument();
		expect(screen.getByText('Pasted text · 128 lines')).toBeInTheDocument();
		expect(screen.queryByText('pasted-text.txt')).not.toBeInTheDocument();
	});

	it('uses the singular form for a one-line paste', () => {
		renderNotices([pastedText({ lineCount: 1 })]);

		expect(screen.getByText('Pasted text · 1 line')).toBeInTheDocument();
	});

	it('removes the attachment by id when the remove button is pressed', async () => {
		const { removeAttachment } = renderNotices([pastedText()]);

		await userEvent.click(
			screen.getByRole('button', { name: /Remove Pasted text/ }),
		);

		expect(removeAttachment).toHaveBeenCalledWith(
			'wsfile:.context/attachments/ee33ff/pasted-text.txt',
		);
	});

	it('renders the plain chip for a workspace file, not the preview card', () => {
		renderNotices([
			{
				id: 'wsfile:src/app.ts',
				kind: 'workspace-file',
				label: 'app.ts',
				path: 'src/app.ts',
			},
		]);

		expect(screen.getByText('app.ts')).toBeInTheDocument();
		expect(screen.queryByText(/Pasted text/)).not.toBeInTheDocument();
	});

	it('labels an issue chip with its reference rather than the document filename', () => {
		renderNotices([
			{
				id: 'issue:linear:THE-106',
				kind: 'issue',
				label: 'THE-106',
				path: '.context/attachments/aa11bb/linear-issue-the-106.md',
				provider: 'linear',
			},
			{
				id: 'issue:github:#42',
				kind: 'issue',
				label: '#42',
				path: '.context/attachments/cc22dd/github-issue-42.md',
				provider: 'github',
			},
		]);

		expect(screen.getByText('THE-106')).toBeInTheDocument();
		expect(screen.getByText('#42')).toBeInTheDocument();
		expect(
			screen.queryByText('linear-issue-the-106.md'),
		).not.toBeInTheDocument();
	});
});

const VAULT: LinkedDirectory = {
	name: 'Vault 111',
	path: '/Users/me/Documents/Obsidian/Vault 111',
};

describe('linked-directory chip', () => {
	it('shows the name over the absolute path it granted', () => {
		renderNotices([], vi.fn(), { linkedDirectories: [VAULT] });

		expect(screen.getByText('Vault 111')).toBeInTheDocument();
		expect(screen.getByText(VAULT.path)).toBeInTheDocument();
	});

	it('renders with no attachments at all, since a link is not a draft attachment', () => {
		renderNotices([], vi.fn(), { linkedDirectories: [VAULT] });

		expect(screen.getByText('Vault 111')).toBeInTheDocument();
	});

	it('unlinks by path when the remove button is pressed', async () => {
		const { unlinkDirectory } = renderNotices([], vi.fn(), {
			linkedDirectories: [VAULT],
		});

		await userEvent.click(
			screen.getByRole('button', { name: /Remove Vault 111/ }),
		);

		expect(unlinkDirectory).toHaveBeenCalledWith(VAULT.path);
	});

	it('warns only while a directory is linked after the session opened', () => {
		renderNotices([], vi.fn(), { linkedDirectories: [VAULT] });

		expect(screen.queryByText(/from the next session/)).not.toBeInTheDocument();
	});

	it('explains that a directory linked mid-session is not readable yet', () => {
		renderNotices([], vi.fn(), {
			linkedDirectories: [VAULT],
			pendingLinkedDirectories: [VAULT],
		});

		expect(screen.getByText(/from the next session/)).toBeInTheDocument();
	});
});
