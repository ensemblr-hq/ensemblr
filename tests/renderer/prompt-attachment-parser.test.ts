import { describe, expect, test } from 'vitest';

import { parsePromptAttachments } from '../../src/renderer/lib/pi/prompt-attachment-parser';

describe('parsePromptAttachments', () => {
	test('extracts a leading attachment block', () => {
		const prompt =
			'<attached_file path="src/a.ts">\nconst a = 1;\n</attached_file>\n\nFix this.';
		const { attachments, text } = parsePromptAttachments(prompt);
		expect(attachments).toEqual([
			{ content: 'const a = 1;', path: 'src/a.ts' },
		]);
		expect(text).toBe('Fix this.');
	});

	test('extracts an attachment block that trails the message', () => {
		const prompt =
			'Please review the changes in this workspace\n\n<attached_file path=".context/attachments/ensemblr-review.md">\n# Review guidelines\n</attached_file>';
		const { attachments, text } = parsePromptAttachments(prompt);
		expect(attachments).toEqual([
			{
				content: '# Review guidelines',
				path: '.context/attachments/ensemblr-review.md',
			},
		]);
		expect(text).toBe('Please review the changes in this workspace');
	});

	test('extracts multiple blocks in order regardless of position', () => {
		const prompt =
			'<attached_file path="a.ts">\nA\n</attached_file>\n\nMiddle text.\n\n<attached_file path="b.ts">\nB\n</attached_file>';
		const { attachments, text } = parsePromptAttachments(prompt);
		expect(attachments.map((a) => a.path)).toEqual(['a.ts', 'b.ts']);
		expect(text).toBe('Middle text.');
	});

	test('strips the user_preferences block without a chip, keeping file chips', () => {
		const prompt =
			'<user_preferences>\nBe concise.\n</user_preferences>\n\nPlease review the changes in this workspace\n\n<attached_file path="ensemblr-review.md">\n# Review\n</attached_file>';
		const { attachments, text } = parsePromptAttachments(prompt);
		expect(text).toBe('Please review the changes in this workspace');
		expect(attachments).toEqual([
			{ content: '# Review', path: 'ensemblr-review.md' },
		]);
	});

	test('decodes escaped quotes in the path', () => {
		const prompt = '<attached_file path="a&quot;b.ts">\nX\n</attached_file>';
		const { attachments } = parsePromptAttachments(prompt);
		expect(attachments[0]?.path).toBe('a"b.ts');
	});
});
