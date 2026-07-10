import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ReadWorkspaceFileResult } from '../../src/shared/ipc/contracts/workspace-files';

const readWorkspaceFile =
	vi.fn<(request: { path: string }) => Promise<ReadWorkspaceFileResult>>();

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	readWorkspaceFile: (request: { path: string }) => readWorkspaceFile(request),
}));

import {
	formatExternalAttachmentText,
	formatMentionAttachmentText,
} from '../../src/renderer/lib/workbench/mention-payload';
import type {
	ExternalAttachment,
	WorkspaceFileSummary,
} from '../../src/renderer/types/workbench';

function fileMention(path: string): WorkspaceFileSummary {
	return {
		id: `wsfile:${path}`,
		kind: 'file',
		name: path.split('/').pop() ?? path,
		path,
	};
}

beforeEach(() => {
	readWorkspaceFile.mockReset();
});

describe('formatMentionAttachmentText', () => {
	test('inlines text files but placeholders binary attachments without reading them', async () => {
		readWorkspaceFile.mockResolvedValue({
			content: 'hello world',
			path: '.context/attachments/notes.txt',
			sizeBytes: 11,
		});

		const text = await formatMentionAttachmentText({
			mentions: [
				fileMention('.context/attachments/notes.txt'),
				fileMention('.context/attachments/report.pdf'),
			],
			workspaceCwd: '/repo',
		});

		expect(text).toContain(
			'<attached_file path=".context/attachments/notes.txt">',
		);
		expect(text).toContain('hello world');
		expect(text).toContain(
			'[attachment saved in the workspace — inspect this file directly if needed]',
		);
		// The pdf is announced by path only — never read as text.
		expect(readWorkspaceFile).toHaveBeenCalledTimes(1);
		expect(readWorkspaceFile).toHaveBeenCalledWith({
			path: '.context/attachments/notes.txt',
			workspaceCwd: '/repo',
		});
	});
});

describe('formatExternalAttachmentText', () => {
	test('returns an empty string when there are no externals', () => {
		expect(formatExternalAttachmentText([])).toBe('');
	});

	test('lists each external file by absolute path with a path-only placeholder', () => {
		const externals: ExternalAttachment[] = [
			{
				absolutePath: '/Users/me/big.mov',
				name: 'big.mov',
				sizeBytes: 42_000_000,
			},
			{
				absolutePath: '/Users/me/data.zip',
				name: 'data.zip',
				sizeBytes: 88_000_000,
			},
		];

		const text = formatExternalAttachmentText(externals);

		expect(text).toContain('<attached_file path="/Users/me/big.mov">');
		expect(text).toContain('<attached_file path="/Users/me/data.zip">');
		expect(text).toContain('[external file — inspect this path directly]');
	});
});
