// @vitest-environment happy-dom

/**
 * A review comment sits in the draft as a chip, and clicking it has to reach the
 * comment preview rather than the markdown document the comment was serialized
 * to — that document is a wire format, not something the user asked to read.
 */

import '@testing-library/jest-dom/vitest';
import { fireEvent, screen } from '@testing-library/react';
import { createRef } from 'react';
import { expect, test, vi } from 'vitest';

import {
	ComposerEditor,
	type ComposerEditorHandle,
} from '@/renderer/components/workbench-shell/conversation-panel/composer/editor';
import {
	CommentPreviewOpenerProvider,
	FilePreviewOpenerProvider,
} from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import type {
	CommentPreviewPayload,
	ComposerAttachment,
} from '@/renderer/types/workbench';

import { renderWithProviders } from './support/dom';

const COMMENT: CommentPreviewPayload = {
	author: 'hubot',
	body: 'needs a guard here',
	detail: 'needs a guard here',
	id: 'comment-open',
	line: 12,
	path: 'src/main/index.ts',
	prNumber: 138,
	provider: 'github',
};

const COMMENT_CHIP: ComposerAttachment = {
	comment: COMMENT,
	id: 'review-comment:comment-open',
	kind: 'review-comment',
	label: 'index.ts:12',
	path: '.context/attachments/ab12cd/review-comment-github-index-ts-12.md',
};

/** Mounts a composer seeded with one chip, over both preview openers. */
function mountWithChip(attachment: ComposerAttachment) {
	const openCommentPreview = vi.fn();
	const openFilePreview = vi.fn();

	renderWithProviders(
		<FilePreviewOpenerProvider value={openFilePreview}>
			<CommentPreviewOpenerProvider value={openCommentPreview}>
				<ComposerEditor
					ariaLabel='Agent composer'
					disabled={false}
					handleRef={createRef<ComposerEditorHandle>()}
					initialSeed={{ attachments: [attachment], text: '' }}
					initialSnapshot={null}
					onBlur={vi.fn()}
					onDraftChange={vi.fn()}
					onDroppedTransfer={() => false}
					onFocus={vi.fn()}
					onKeyDown={vi.fn()}
					onPastedTransfer={() => false}
					placeholder='Ask to make changes'
				/>
			</CommentPreviewOpenerProvider>
		</FilePreviewOpenerProvider>,
	);

	return { openCommentPreview, openFilePreview };
}

test('clicking the chip opens the comment preview, not its serialized document', () => {
	const { openCommentPreview, openFilePreview } = mountWithChip(COMMENT_CHIP);

	fireEvent.click(screen.getByRole('button', { name: 'Open index.ts:12' }));

	expect(openCommentPreview).toHaveBeenCalledWith({
		comment: COMMENT,
		prNumber: 138,
	});
	expect(openFilePreview).not.toHaveBeenCalled();
});

test('the chip wears the comment provider mark', () => {
	mountWithChip(COMMENT_CHIP);

	expect(screen.getByRole('img', { name: 'GitHub' })).toBeInTheDocument();
});

// The chip is labelled by the file's basename to survive the composer's width,
// so two comments on same-named files in different directories read identically
// until the tooltip names the directory they came from.
test('the chip tooltip names the full path the basename label hides', () => {
	mountWithChip(COMMENT_CHIP);

	expect(
		screen.getByRole('button', { name: 'Open index.ts:12' }).closest('span'),
	).toHaveAttribute('title', 'src/main/index.ts:12');
});

// A local note has no pull request behind it, and passing a stray number would
// send the preview looking for a thread on a PR the comment never sat on.
test('a local comment opens with no pull request number', () => {
	const local: ComposerAttachment = {
		...COMMENT_CHIP,
		comment: {
			body: 'guard this',
			detail: 'guard this',
			id: 'local-1',
			line: 12,
			origin: 'user',
			path: 'src/main/index.ts',
			provider: 'local',
		},
		id: 'review-comment:local-1',
	};

	const { openCommentPreview } = mountWithChip(local);
	fireEvent.click(screen.getByRole('button', { name: 'Open index.ts:12' }));

	expect(openCommentPreview).toHaveBeenCalledWith(
		expect.objectContaining({ prNumber: undefined }),
	);
});
