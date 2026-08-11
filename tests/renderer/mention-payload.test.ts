import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ReadWorkspaceFileResult } from '../../src/shared/ipc/contracts/workspace-files';

const readWorkspaceFile =
	vi.fn<(request: { path: string }) => Promise<ReadWorkspaceFileResult>>();

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	readWorkspaceFile: (request: { path: string }) => readWorkspaceFile(request),
}));

import {
	serializeComposerAttachments,
	serializeLinkedDirectories,
} from '../../src/renderer/lib/workbench/mention-payload';
import type { ComposerAttachment } from '../../src/renderer/types/workbench';

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

describe('serializeComposerAttachments', () => {
	test('returns an empty string when there is nothing attached', async () => {
		expect(
			await serializeComposerAttachments({
				attachments: [],
				workspaceCwd: '/repo',
			}),
		).toBe('');
	});

	test('inlines text files but placeholders binary attachments without reading them', async () => {
		readWorkspaceFile.mockResolvedValue({
			content: 'hello world',
			path: '.context/attachments/aa11bb/notes.txt',
			sizeBytes: 11,
		});

		const text = await serializeComposerAttachments({
			attachments: [
				fileAttachment('.context/attachments/aa11bb/notes.txt'),
				fileAttachment('.context/attachments/cc22dd/report.pdf'),
			],
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

	test('lists each external file by absolute path with a path-only placeholder', async () => {
		const text = await serializeComposerAttachments({
			attachments: [
				externalAttachment('/Users/me/big.mov', 42_000_000),
				externalAttachment('/Users/me/data.zip', 88_000_000),
			],
			workspaceCwd: '/repo',
		});

		expect(text).toContain('<attached_file path="/Users/me/big.mov">');
		expect(text).toContain('<attached_file path="/Users/me/data.zip">');
		expect(text).toContain('[external file — inspect this path directly]');
		expect(readWorkspaceFile).not.toHaveBeenCalled();
	});

	test('collects directories into one leading referenced-folders block', async () => {
		const text = await serializeComposerAttachments({
			attachments: [
				{
					id: 'wsdir:src/renderer',
					kind: 'workspace-directory',
					label: 'renderer',
					path: 'src/renderer',
				},
				externalAttachment('/Users/me/big.mov', 42_000_000),
				{
					id: 'wsdir:src/main',
					kind: 'workspace-directory',
					label: 'main',
					path: 'src/main',
				},
			],
			workspaceCwd: '/repo',
		});

		expect(text.startsWith('Referenced workspace folders:\n')).toBe(true);
		expect(text).toContain('@src/renderer\n@src/main');
		expect(text.match(/Referenced workspace folders:/g)).toHaveLength(1);
	});

	test('keeps sections in the order the user attached them', async () => {
		readWorkspaceFile.mockResolvedValue({
			content: 'inlined',
			path: 'notes.md',
			sizeBytes: 7,
		});

		const text = await serializeComposerAttachments({
			attachments: [
				externalAttachment('/Users/me/big.mov', 42_000_000),
				fileAttachment('notes.md'),
			],
			workspaceCwd: '/repo',
		});

		expect(text.indexOf('/Users/me/big.mov')).toBeLessThan(
			text.indexOf('notes.md'),
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
