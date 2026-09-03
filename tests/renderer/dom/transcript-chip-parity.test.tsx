// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { ChatUserPrompt } from '../../../src/renderer/components/chat-user-prompt';
import { AttachmentChip } from '../../../src/renderer/components/workbench-shell/conversation-panel/composer/attachment-chip';
import { attachmentMark } from '../../../src/renderer/lib/attachment-mark';
import type { ComposerAttachment } from '../../../src/renderer/types/workbench';
import { formatAttachedFileBlock } from '../../../src/shared/prompt-scaffolding';
import { renderWithProviders } from '../support/dom';

const TRANSCRIPT_PATH = '.context/sessions/b4d21395-116b-4993-a2b1-0e578b.md';
const TRANSCRIPT_TITLE = 'Concierge: allow duplicate chips';

/** One transcript attachment as the new-chat picker dispatches it. */
function transcript(isSubAgent: boolean): ComposerAttachment {
	return {
		id: 'transcript:tab-1',
		isSubAgent,
		kind: 'chat-transcript',
		label: TRANSCRIPT_TITLE,
		path: TRANSCRIPT_PATH,
	};
}

/**
 * The prompt text `serializeComposerDraft` writes for one transcript chip, which
 * is all the sent bubble has to rebuild the chip from.
 */
function sentPrompt(attachment: ComposerAttachment): string {
	const mark = attachmentMark(attachment);
	return `${formatAttachedFileBlock(TRANSCRIPT_PATH, '# Session summary', {
		label: attachment.label,
		...(mark ? { mark } : {}),
	})}\n\nCarry on from here.`;
}

/** The lucide glyph a rendered chip leads with, read off its stable class. */
function glyphName(root: HTMLElement): string | undefined {
	const glyph = root.querySelector('svg.lucide');
	return [...(glyph?.classList ?? [])].find((name) =>
		name.startsWith('lucide-'),
	);
}

describe('a chat transcript chip', () => {
	test('wears a sparkle in the composer and the same one once sent', () => {
		const { container: composer } = renderWithProviders(
			<AttachmentChip
				attachment={transcript(false)}
				onRemove={() => undefined}
			/>,
		);
		const { container: sent } = renderWithProviders(
			<ChatUserPrompt prompt={sentPrompt(transcript(false))} />,
		);

		expect(glyphName(composer)).toBe('lucide-sparkles');
		expect(glyphName(sent)).toBe('lucide-sparkles');
	});

	test('wears a robot on both surfaces when a sub-agent wrote it', () => {
		const { container: composer } = renderWithProviders(
			<AttachmentChip
				attachment={transcript(true)}
				onRemove={() => undefined}
			/>,
		);
		const { container: sent } = renderWithProviders(
			<ChatUserPrompt prompt={sentPrompt(transcript(true))} />,
		);

		expect(glyphName(composer)).toBe('lucide-bot');
		expect(glyphName(sent)).toBe('lucide-bot');
	});

	test('reads back as the chat title rather than the summary filename', () => {
		renderWithProviders(
			<ChatUserPrompt prompt={sentPrompt(transcript(false))} />,
		);

		expect(screen.getByText(TRANSCRIPT_TITLE)).toBeInTheDocument();
		expect(screen.queryByText(/b4d21395/)).toBeNull();
	});

	test('falls back to the basename for a prompt sent before descriptors', () => {
		renderWithProviders(
			<ChatUserPrompt
				prompt={`<attached_file path="${TRANSCRIPT_PATH}">\n# Session summary\n</attached_file>`}
			/>,
		);

		expect(
			screen.getByText('b4d21395-116b-4993-a2b1-0e578b.md'),
		).toBeInTheDocument();
	});
});
