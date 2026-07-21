import { describe, expect, test } from 'vitest';
import { stripPromptScaffolding } from '../../src/main/pi-agent/naming/derive-title-source';
import {
	buildActionAttachmentBlock,
	wrapWithMasterPrompt,
} from '../../src/renderer/lib/workbench/action-prompts';
import { REFERENCED_FOLDERS_HEADER } from '../../src/shared/prompt-scaffolding';

describe('stripPromptScaffolding', () => {
	test('returns plain typed text untouched', () => {
		expect(stripPromptScaffolding('Fix the login redirect bug')).toBe(
			'Fix the login redirect bug',
		);
	});

	test('strips a leading user_preferences block', () => {
		const wrapped =
			'<user_preferences>\nBe concise.\n</user_preferences>\n\nAdd a dark mode toggle';
		expect(stripPromptScaffolding(wrapped)).toBe('Add a dark mode toggle');
	});

	test('strips attached_file blocks', () => {
		const withFile =
			'<attached_file path="src/app.ts">\nexport const x = 1;\n</attached_file>\nRefactor the exports';
		expect(stripPromptScaffolding(withFile)).toBe('Refactor the exports');
	});

	test('strips the referenced-folders preamble', () => {
		const withFolders =
			'Referenced workspace folders:\n@src/main\n@src/renderer\n\nWire up the naming path';
		expect(stripPromptScaffolding(withFolders)).toBe('Wire up the naming path');
	});

	test('collapses to empty when only scaffolding remains', () => {
		const onlyScaffolding =
			'<user_preferences>\nBe concise.\n</user_preferences>';
		expect(stripPromptScaffolding(onlyScaffolding)).toBe('');
	});

	test("strips the renderer's actual composed scaffolding", () => {
		const folders = `${REFERENCED_FOLDERS_HEADER}\n@src/main\n@src/renderer`;
		const attachment = buildActionAttachmentBlock(
			'src/app.ts',
			'export const x = 1;',
		);
		const composed = wrapWithMasterPrompt(
			'Be concise.',
			`${folders}\n\n${attachment}\n\nAdd a dark mode toggle`,
		);
		expect(stripPromptScaffolding(composed)).toBe('Add a dark mode toggle');
	});

	test('strips a referenced-folders block interleaved after text', () => {
		const interleaved = `Wire up the naming path\n\n${REFERENCED_FOLDERS_HEADER}\n@src/main\n@src/renderer\n`;
		expect(stripPromptScaffolding(interleaved)).toBe('Wire up the naming path');
	});
});
