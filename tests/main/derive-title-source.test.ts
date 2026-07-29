import { describe, expect, test } from 'vitest';
import {
	deriveTitleSource,
	stripPromptScaffolding,
} from '../../src/main/pi-agent/naming/derive-title-source';
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

describe('deriveTitleSource', () => {
	test('drops a leading skill invocation and keeps its arguments', () => {
		expect(deriveTitleSource('/skill:caveman write a haiku')).toBe(
			'write a haiku',
		);
	});

	test('drops a leading slash command and keeps its arguments', () => {
		expect(deriveTitleSource('/plan add a dark mode toggle')).toBe(
			'add a dark mode toggle',
		);
	});

	test('strips scaffolding before looking for the slash command', () => {
		const wrapped = wrapWithMasterPrompt(
			'Be concise.',
			'/skill:caveman write a haiku',
		);
		expect(deriveTitleSource(wrapped)).toBe('write a haiku');
	});

	test('strips a referenced-folders preamble before the slash command', () => {
		const withFolders = `${REFERENCED_FOLDERS_HEADER}\n@src/main\n\n/plan ship it`;
		expect(deriveTitleSource(withFolders)).toBe('ship it');
	});

	test('falls back to the humanized command name for a bare skill', () => {
		expect(deriveTitleSource('/skill:caveman')).toBe('Caveman');
	});

	test('falls back to the humanized command name for a bare command', () => {
		expect(deriveTitleSource('/compact')).toBe('Compact');
	});

	test('humanizes separators in a bare command name', () => {
		expect(deriveTitleSource('/skill:code-review')).toBe('Code review');
	});

	test("reads Pi's expanded skill block as the same invocation", () => {
		const expanded =
			'<skill name="caveman" location="/skills/caveman/SKILL.md">\nbody\n</skill>\n\nwrite a haiku';
		expect(deriveTitleSource(expanded)).toBe('write a haiku');
	});

	test('keeps multi-line arguments so the title draws from the first line', () => {
		expect(deriveTitleSource('/plan\nline one\nline two')).toBe(
			'line one\nline two',
		);
	});

	test('leaves a path that merely starts with a slash alone', () => {
		expect(deriveTitleSource('/usr/bin/env is on PATH')).toBe(
			'/usr/bin/env is on PATH',
		);
	});

	test('leaves a non-leading slash alone', () => {
		expect(deriveTitleSource('Use / to open the command menu')).toBe(
			'Use / to open the command menu',
		);
	});

	test('leaves a bare slash alone', () => {
		expect(deriveTitleSource('/ leading slash space')).toBe(
			'/ leading slash space',
		);
	});

	test('returns plain typed text untouched', () => {
		expect(deriveTitleSource('Fix the login redirect bug')).toBe(
			'Fix the login redirect bug',
		);
	});

	test('returns empty when only scaffolding remains', () => {
		expect(
			deriveTitleSource('<user_preferences>\nBe concise.\n</user_preferences>'),
		).toBe('');
	});
});
