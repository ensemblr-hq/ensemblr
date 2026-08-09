import { describe, expect, test } from 'vitest';

import {
	findingsForFile,
	isUserFacingProse,
	suppressedLines,
} from '../../scripts/hardcoded-strings-scan.mjs';

const covered = (source) =>
	[...suppressedLines(source.split('\n'))].sort((a, b) => a - b);

describe('suppressedLines', () => {
	test('covers the directive and the single-line statement under it', () => {
		const source = [
			'const a = 1;',
			'\t// i18next-instrument-ignore -- brand',
			"\tmessage: 'Could not load branches for this repository.',",
			"const trailing = 'A sentence the gate must still report.';",
		].join('\n');

		expect(covered(source)).toEqual([2, 3]);
	});

	test('skips further comment lines before the statement starts', () => {
		const source = [
			'\t\t\t// i18next-instrument-ignore -- English fallback behind the code the',
			'\t\t\t// renderer translates; see githubFailureText.',
			"\t\t\tmessage: 'Could not load branches for this repository.',",
			"\t\t\tremediation: 'A sentence the gate must still report.',",
		].join('\n');

		expect(covered(source)).toEqual([1, 2, 3]);
	});

	test('stops at the end of a block statement instead of running to EOF', () => {
		const source = [
			'export function getProviderLabel(provider) {',
			"\tif (provider === 'github') {",
			"\t\treturn 'GitHub';",
			'\t}',
			'',
			'\t// i18next-instrument-ignore -- product name',
			"\tif (provider === 'github-actions') {",
			"\t\treturn 'GitHub Actions';",
			'\t}',
			'',
			"\tif (provider === 'other') {",
			"\t\treturn 'This sentence is plainly user facing and must be caught.';",
			'\t}',
			'}',
		].join('\n');

		expect(covered(source)).toEqual([6, 7, 8, 9]);
	});

	test('covers a whole const table without spilling past its closing brace', () => {
		const source = [
			'// i18next-instrument-ignore -- vendor and runtime brand names',
			'const PROVIDER_DISPLAY_NAMES = {',
			"\tanthropic: 'Anthropic',",
			"\t'claude-code': 'Claude Code',",
			'};',
			"const after = 'A sentence the gate must still report.';",
		].join('\n');

		expect(covered(source)).toEqual([1, 2, 3, 4, 5]);
	});

	test('covers a multi-line template literal to its closing backtick', () => {
		const source = [
			'// i18next-instrument-ignore -- source-code specimen for the font preview',
			'const MONO_PREVIEW = `// Preview',
			"const greeting = 'Hello, World!';",
			'function sum(a, b) { return a + b; }`;',
			"const after = 'A sentence the gate must still report.';",
		].join('\n');

		expect(covered(source)).toEqual([1, 2, 3, 4]);
	});
});

describe('findingsForFile', () => {
	test('reports prose that follows a block-scoped ignore directive', () => {
		const source = [
			'export function probe(kind) {',
			'\t// i18next-instrument-ignore -- product name',
			"\tif (kind === 'github-actions') {",
			"\t\treturn 'GitHub Actions';",
			'\t}',
			'',
			"\tif (kind === 'other') {",
			"\t\treturn 'This sentence is plainly user facing and must be caught.';",
			'\t}',
			'',
			"\treturn 'Another untranslated sentence that the gate should report.';",
			'}',
		].join('\n');

		expect(findingsForFile('src/renderer/probe.ts', source)).toEqual([
			{
				file: 'src/renderer/probe.ts',
				line: 8,
				value: 'This sentence is plainly user facing and must be caught.',
			},
			{
				file: 'src/renderer/probe.ts',
				line: 11,
				value: 'Another untranslated sentence that the gate should report.',
			},
		]);
	});

	test('leaves the literal an ignore directive actually guards alone', () => {
		const source = [
			'export function label() {',
			'\t// i18next-instrument-ignore -- product name',
			"\treturn 'GitHub Actions for teams';",
			'}',
		].join('\n');

		expect(findingsForFile('src/renderer/label.ts', source)).toEqual([]);
	});

	test('ignores prose inside a t() call', () => {
		const source = [
			'export function label(t) {',
			"\treturn t('workbench:probe.label', 'A sentence that is already translated.');",
			'}',
		].join('\n');

		expect(findingsForFile('src/renderer/label.ts', source)).toEqual([]);
	});

	test('skips a literal whose property name is styling rather than copy', () => {
		const source = [
			'export function Row() {',
			"\tconst className = 'flex flex-col items-center justify-between gap';",
			'\treturn className;',
			'}',
		].join('\n');

		expect(findingsForFile('src/renderer/row.ts', source)).toEqual([]);
	});
});

describe('isUserFacingProse', () => {
	test('accepts a sentence and rejects identifiers, paths, and class lists', () => {
		expect(isUserFacingProse('Everything here is committed.')).toBe(true);
		expect(isUserFacingProse('workbench:dock-tab.terminal.label')).toBe(false);
		expect(isUserFacingProse('./relative/path.ts')).toBe(false);
		expect(isUserFacingProse('flex items-center gap-1')).toBe(false);
		expect(isUserFacingProse('Loading…')).toBe(false);
	});
});
