import { describe, expect, test } from 'vitest';

import { parsePromptAttachments } from '../../src/renderer/lib/agent-timeline/prompt-attachment-parser';
import type { ParsedPromptPart } from '../../src/renderer/types/agent-timeline';

/** The typed runs, in order. */
function texts(parts: readonly ParsedPromptPart[]): string[] {
	return parts.flatMap((part) => (part.kind === 'text' ? [part.text] : []));
}

/** The attachments, in order. */
function attachments(parts: readonly ParsedPromptPart[]) {
	return parts.flatMap((part) =>
		part.kind === 'attachment' ? [part.attachment] : [],
	);
}

/** Reads a part back as the text or path it renders, whichever it carries. */
function partLabel(part: ParsedPromptPart): string {
	if (part.kind === 'attachment') {
		return part.attachment.path;
	}
	return part.kind === 'text' ? part.text : part.reference.label;
}

describe('parsePromptAttachments', () => {
	test('extracts a leading attachment block', () => {
		const prompt =
			'<attached_file path="src/a.ts">\nconst a = 1;\n</attached_file>\n\nFix this.';
		const { parts } = parsePromptAttachments(prompt);
		expect(attachments(parts)).toEqual([
			{ content: 'const a = 1;', path: 'src/a.ts' },
		]);
		expect(texts(parts)).toEqual(['Fix this.']);
	});

	test('extracts an attachment block that trails the message', () => {
		const prompt =
			'Please review the changes in this workspace\n\n<attached_file path=".context/attachments/ensemblr-review.md">\n# Review guidelines\n</attached_file>';
		const { parts } = parsePromptAttachments(prompt);
		expect(attachments(parts)).toEqual([
			{
				content: '# Review guidelines',
				path: '.context/attachments/ensemblr-review.md',
			},
		]);
		expect(texts(parts)).toEqual([
			'Please review the changes in this workspace',
		]);
	});

	test('reads a Concierge reference block back as a reference part', () => {
		const prompt = [
			'what changed in',
			'<referenced_workspace name="khachaturian" workspaceId="ws-1" projectId="repo-1" project="ensemblr" cwd="/w/k" />',
			'today?',
		].join('\n\n');
		const { parts } = parsePromptAttachments(prompt);

		expect(parts.map(partLabel)).toEqual([
			'what changed in',
			'khachaturian',
			'today?',
		]);
		expect(parts[1]).toMatchObject({
			kind: 'reference',
			reference: {
				kind: 'workspace',
				projectId: 'repo-1',
				workspaceId: 'ws-1',
			},
		});
	});

	test('keeps the typed runs and the blocks in the order they were sent', () => {
		const prompt =
			'<attached_file path="a.ts">\nA\n</attached_file>\n\nMiddle text.\n\n<attached_file path="b.ts">\nB\n</attached_file>\n\nTrailing.';
		const { parts } = parsePromptAttachments(prompt);
		expect(parts.map((part) => partLabel(part))).toEqual([
			'a.ts',
			'Middle text.',
			'b.ts',
			'Trailing.',
		]);
	});

	test('strips the user_preferences block without a chip, keeping file chips', () => {
		const prompt =
			'<user_preferences>\nBe concise.\n</user_preferences>\n\nPlease review the changes in this workspace\n\n<attached_file path="ensemblr-review.md">\n# Review\n</attached_file>';
		const { parts } = parsePromptAttachments(prompt);
		expect(texts(parts)).toEqual([
			'Please review the changes in this workspace',
		]);
		expect(attachments(parts)).toEqual([
			{ content: '# Review', path: 'ensemblr-review.md' },
		]);
	});

	test('decodes escaped quotes in the path', () => {
		const { parts } = parsePromptAttachments(
			'<attached_file path="a&quot;b.ts">\nX\n</attached_file>',
		);
		expect(attachments(parts)[0]?.path).toBe('a"b.ts');
	});

	test('strips the linked-directories preamble without a chip per turn', () => {
		const prompt =
			'Linked directories:\n/Users/me/Vault\n/Users/me/designs\n\nCheck my notes.';
		const { parts } = parsePromptAttachments(prompt);
		expect(attachments(parts)).toEqual([]);
		expect(texts(parts)).toEqual(['Check my notes.']);
	});

	test('keeps referenced folders as chips while dropping linked directories', () => {
		const prompt =
			'Linked directories:\n/Users/me/Vault\n\nReferenced workspace folders:\n@src/renderer\n\nRefactor this.';
		const { parts } = parsePromptAttachments(prompt);
		expect(attachments(parts)).toEqual([{ content: '', path: 'src/renderer' }]);
		expect(texts(parts)).toEqual(['Refactor this.']);
	});

	test('reads a folder chip that fell mid-sentence at the position it was sent', () => {
		const prompt =
			'Compare\n\nReferenced workspace folders:\n@src/main\n\nagainst\n\nReferenced workspace folders:\n@src/renderer';
		const { parts } = parsePromptAttachments(prompt);
		expect(parts.map((part) => partLabel(part))).toEqual([
			'Compare',
			'src/main',
			'against',
			'src/renderer',
		]);
	});

	test('ignores a header that is only part of an inlined file body', () => {
		const prompt =
			'<attached_file path="notes.md">\nReferenced workspace folders:\n@src/decoy\n</attached_file>\n\nRead it.';
		const { parts } = parsePromptAttachments(prompt);
		expect(attachments(parts).map((entry) => entry.path)).toEqual(['notes.md']);
		expect(texts(parts)).toEqual(['Read it.']);
	});

	test('returns no parts for a prompt that was pure scaffolding', () => {
		expect(
			parsePromptAttachments(
				'<user_preferences>\nBe concise.\n</user_preferences>',
			).parts,
		).toEqual([]);
	});
});
