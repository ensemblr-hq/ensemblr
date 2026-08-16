import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ReadWorkspaceFileResult } from '../../src/shared/ipc/contracts/workspace-files';

const readWorkspaceFile =
	vi.fn<(request: { path: string }) => Promise<ReadWorkspaceFileResult>>();

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	readWorkspaceFile: (request: { path: string }) => readWorkspaceFile(request),
}));

import {
	serializeComposerDraft,
	serializeLinkedDirectories,
} from '../../src/renderer/lib/workbench/mention-payload';
import type {
	ComposerAttachment,
	ComposerDraftSegment,
} from '../../src/renderer/types/workbench';

/** Wraps attachments as the chip-only draft the old attachment-list tests sent. */
function chips(
	...attachments: readonly ComposerAttachment[]
): readonly ComposerDraftSegment[] {
	return attachments.map((attachment) => ({
		attachment,
		kind: 'attachment' as const,
	}));
}

function directoryAttachment(path: string): ComposerAttachment {
	return {
		id: `wsdir:${path}`,
		kind: 'workspace-directory',
		label: path.split('/').pop() ?? path,
		path,
	};
}

function fileAttachment(path: string): ComposerAttachment {
	return {
		id: `wsfile:${path}`,
		kind: 'workspace-file',
		label: path.split('/').pop() ?? path,
		path,
	};
}

function externalAttachment(
	absolutePath: string,
	sizeBytes: number,
): ComposerAttachment {
	return {
		absolutePath,
		id: `external:${absolutePath}`,
		kind: 'external-file',
		label: absolutePath.split('/').pop() ?? absolutePath,
		sizeBytes,
	};
}

beforeEach(() => {
	readWorkspaceFile.mockReset();
});

describe('serializeComposerDraft', () => {
	test('returns an empty string when the draft is blank', async () => {
		expect(
			await serializeComposerDraft({ segments: [], workspaceCwd: '/repo' }),
		).toBe('');
	});

	test('inlines text files but placeholders binary attachments without reading them', async () => {
		readWorkspaceFile.mockResolvedValue({
			content: 'hello world',
			path: '.context/attachments/aa11bb/notes.txt',
			sizeBytes: 11,
		});

		const text = await serializeComposerDraft({
			segments: chips(
				fileAttachment('.context/attachments/aa11bb/notes.txt'),
				fileAttachment('.context/attachments/cc22dd/report.pdf'),
			),
			workspaceCwd: '/repo',
		});

		expect(text).toContain(
			'<attached_file path=".context/attachments/aa11bb/notes.txt">',
		);
		expect(text).toContain('hello world');
		expect(text).toContain(
			'[attachment saved in the workspace — inspect this file directly if needed]',
		);
		// The pdf is announced by path only — never read as text.
		expect(readWorkspaceFile).toHaveBeenCalledTimes(1);
		expect(readWorkspaceFile).toHaveBeenCalledWith({
			path: '.context/attachments/aa11bb/notes.txt',
			workspaceCwd: '/repo',
		});
	});

	test('announces a text-extension file the read refused as binary by path', async () => {
		readWorkspaceFile.mockResolvedValue({
			binaryReason: 'not-text',
			contentEncoding: 'binary',
			path: 'exports/data.csv',
			sizeBytes: 4096,
		});

		const text = await serializeComposerDraft({
			segments: chips(fileAttachment('exports/data.csv')),
			workspaceCwd: '/repo',
		});

		expect(text).toContain(
			'[attachment saved in the workspace — inspect this file directly if needed]',
		);
		expect(text).not.toContain('<attached_file path="exports/data.csv"></');
	});

	test('lists each external file by absolute path with a path-only placeholder', async () => {
		const text = await serializeComposerDraft({
			segments: chips(
				externalAttachment('/Users/me/big.mov', 42_000_000),
				externalAttachment('/Users/me/data.zip', 88_000_000),
			),
			workspaceCwd: '/repo',
		});

		expect(text).toContain('<attached_file path="/Users/me/big.mov">');
		expect(text).toContain('<attached_file path="/Users/me/data.zip">');
		expect(text).toContain('[external file — inspect this path directly]');
		expect(readWorkspaceFile).not.toHaveBeenCalled();
	});

	test('collects adjacent directories into one referenced-folders block', async () => {
		const text = await serializeComposerDraft({
			segments: chips(
				directoryAttachment('src/renderer'),
				directoryAttachment('src/main'),
			),
			workspaceCwd: '/repo',
		});

		expect(text).toBe(
			'Referenced workspace folders:\n@src/renderer\n@src/main',
		);
	});

	test('gives a directory its own header when another block splits the run', async () => {
		const text = await serializeComposerDraft({
			segments: chips(
				directoryAttachment('src/renderer'),
				externalAttachment('/Users/me/big.mov', 42_000_000),
				directoryAttachment('src/main'),
			),
			workspaceCwd: '/repo',
		});

		expect(text.match(/Referenced workspace folders:/g)).toHaveLength(2);
		expect(text.indexOf('@src/renderer')).toBeLessThan(
			text.indexOf('/Users/me/big.mov'),
		);
		expect(text.indexOf('/Users/me/big.mov')).toBeLessThan(
			text.indexOf('@src/main'),
		);
	});

	test('keeps blocks in the order the user attached them', async () => {
		readWorkspaceFile.mockResolvedValue({
			content: 'inlined',
			path: 'notes.md',
			sizeBytes: 7,
		});

		const text = await serializeComposerDraft({
			segments: chips(
				externalAttachment('/Users/me/big.mov', 42_000_000),
				fileAttachment('notes.md'),
			),
			workspaceCwd: '/repo',
		});

		expect(text.indexOf('/Users/me/big.mov')).toBeLessThan(
			text.indexOf('notes.md'),
		);
	});

	test('lands each attachment where its chip sat in the sentence', async () => {
		readWorkspaceFile.mockResolvedValue({
			content: 'inlined',
			path: 'notes.md',
			sizeBytes: 7,
		});

		const text = await serializeComposerDraft({
			segments: [
				{ kind: 'text', text: 'compare ' },
				...chips(fileAttachment('notes.md')),
				{ kind: 'text', text: ' against ' },
				...chips(externalAttachment('/Users/me/big.mov', 42_000_000)),
				{ kind: 'text', text: ' and report back' },
			],
			workspaceCwd: '/repo',
		});

		expect(text).toBe(
			[
				'compare',
				'<attached_file path="notes.md">\ninlined\n</attached_file>',
				'against',
				'<attached_file path="/Users/me/big.mov">\n[external file — inspect this path directly]\n</attached_file>',
				'and report back',
			].join('\n\n'),
		);
	});

	test('drops the whitespace a chip left behind rather than emitting a blank block', async () => {
		const text = await serializeComposerDraft({
			segments: [
				{ kind: 'text', text: '  ' },
				...chips(directoryAttachment('src/main')),
				{ kind: 'text', text: ' ' },
				...chips(directoryAttachment('src/renderer')),
			],
			workspaceCwd: '/repo',
		});

		expect(text).toBe(
			'Referenced workspace folders:\n@src/main\n@src/renderer',
		);
	});
});

// A review-comment chip is serialized by the same path-driven rules as any other
// stored document, so a change to those rules must not quietly turn the comment
// into a placeholder the agent cannot read.
describe('serializeComposerDraft with a review comment', () => {
	test('inlines the comment document where the chip sat in the sentence', async () => {
		readWorkspaceFile.mockResolvedValue({
			content: '# Review comment on page.tsx:57',
			path: '.context/attachments/ab12cd/review-comment-github-page-tsx-57.md',
			sizeBytes: 31,
		});

		const text = await serializeComposerDraft({
			segments: [
				{ kind: 'text', text: 'address' },
				{
					attachment: {
						comment: {
							body: 'Guard this.',
							detail: 'Guard this.',
							id: 'c1',
							provider: 'github',
						},
						id: 'review-comment:c1',
						kind: 'review-comment',
						label: 'page.tsx:57',
						path: '.context/attachments/ab12cd/review-comment-github-page-tsx-57.md',
					},
					kind: 'attachment',
				},
				{ kind: 'text', text: 'please' },
			],
			workspaceCwd: '/repo',
		});

		expect(text).toBe(
			[
				'address',
				'',
				'<attached_file path=".context/attachments/ab12cd/review-comment-github-page-tsx-57.md">',
				'# Review comment on page.tsx:57',
				'</attached_file>',
				'',
				'please',
			].join('\n'),
		);
	});
});

describe('serializeLinkedDirectories', () => {
	test('returns an empty string when nothing is linked', () => {
		expect(serializeLinkedDirectories([])).toBe('');
	});

	test('announces every linked directory by absolute path under one header', () => {
		expect(
			serializeLinkedDirectories([
				{ name: 'Vault 111', path: '/Users/me/Documents/Vault 111' },
				{ name: 'designs', path: '/Users/me/designs' },
			]),
		).toBe(
			'Linked directories:\n/Users/me/Documents/Vault 111\n/Users/me/designs',
		);
	});

	test('leaves the path unprefixed so it is not read as a repo-relative mention', () => {
		expect(
			serializeLinkedDirectories([{ name: 'x', path: '/tmp/x' }]),
		).not.toContain('@/tmp/x');
	});
});
