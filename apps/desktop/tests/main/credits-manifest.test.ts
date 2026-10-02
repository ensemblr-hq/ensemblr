import { describe, expect, test } from 'vitest';

// @ts-expect-error - the generator is a plain .mjs dev script with no typings.
import { buildCreditsManifest } from '../../scripts/generate-credits.mjs';
import { aboutPanelStrings } from '../../src/main/menu/about-panel-strings';
import { creditLines, creditsText } from '../../src/main/menu/credits';
import { CREDITS_PACKAGES } from '../../src/main/menu/credits-manifest.gen';

describe('credits manifest', () => {
	test('matches what the generator produces from package.json today', () => {
		expect(CREDITS_PACKAGES).toEqual(buildCreditsManifest());
	});

	test('credits every direct dependency exactly once', () => {
		const names = CREDITS_PACKAGES.map((entry) => entry.name);
		expect(new Set(names).size).toBe(names.length);
		expect(names.length).toBeGreaterThan(0);
	});

	test('every entry carries a license and an https project link', () => {
		for (const entry of CREDITS_PACKAGES) {
			expect(entry.license.length).toBeGreaterThan(0);
			expect(entry.url.startsWith('https://')).toBe(true);
		}
	});

	// npm accepts `SEE LICENSE IN <file>` and `UNLICENSED`, neither of which is
	// a license name; rendered raw they read as a bug beside `MIT`.
	test('names every license rather than pointing at a file', () => {
		for (const entry of CREDITS_PACKAGES) {
			expect(entry.license).not.toMatch(/^SEE LICEN[CS]E IN /i);
			expect(entry.license).not.toBe('UNLICENSED');
		}
	});

	test('labels bespoke terms so the column reads as licenses throughout', () => {
		const sdk = CREDITS_PACKAGES.find(
			(entry) => entry.name === '@anthropic-ai/claude-agent-sdk',
		);
		expect(sdk?.license).toBe('Custom license');
	});
});

describe('creditLines', () => {
	const strings = aboutPanelStrings('en');

	test('opens with the author and closes with the inspiration', () => {
		const lines = creditLines(strings, CREDITS_PACKAGES, 'Philipp Soldunov');
		expect(lines[0]).toBe('Philipp Soldunov');
		expect(lines.at(-1)).toBe(
			'Inspired by Conductor <https://conductor.build>',
		);
	});

	test('groups the dependencies under their headings', () => {
		const lines = creditLines(strings, CREDITS_PACKAGES, 'Philipp Soldunov');
		const core = lines.indexOf(strings.coreProjects);
		const development = lines.indexOf(strings.developmentTools);
		expect(core).toBeGreaterThan(0);
		expect(development).toBeGreaterThan(core);
	});

	test('renders one linkable line per package', () => {
		const lines = creditLines(
			strings,
			[
				{
					name: 'react',
					license: 'MIT',
					url: 'https://react.dev/',
					kind: 'runtime',
				},
			],
			'Philipp Soldunov',
		);
		expect(lines).toContain('react — MIT <https://react.dev/>');
		expect(lines.filter((line) => line.startsWith('─')).length).toBe(2);
	});

	test('omits a heading whose group is empty', () => {
		const lines = creditLines(
			strings,
			[
				{
					name: 'react',
					license: 'MIT',
					url: 'https://react.dev/',
					kind: 'runtime',
				},
			],
			'Philipp Soldunov',
		);
		expect(lines).not.toContain(strings.developmentTools);
	});

	test('substitutes the inspiration name in every language', () => {
		for (const language of ['ru', 'el'] as const) {
			const lines = creditLines(
				aboutPanelStrings(language),
				CREDITS_PACKAGES,
				'Philipp Soldunov',
			);
			expect(lines.some((line) => line.includes('Conductor'))).toBe(true);
			expect(lines.some((line) => line.includes('{{name}}'))).toBe(false);
		}
	});
});

describe('creditsText', () => {
	const strings = aboutPanelStrings('en');

	test('credits every package without the URL macOS cannot linkify', () => {
		const text = creditsText(strings, CREDITS_PACKAGES, 'Philipp Soldunov');
		for (const entry of CREDITS_PACKAGES) {
			expect(text).toContain(`${entry.name} — ${entry.license}`);
			expect(text).not.toContain(entry.url);
		}
	});

	test('keeps the inspiration last, as a bare host', () => {
		const text = creditsText(strings, CREDITS_PACKAGES, 'Philipp Soldunov');
		expect(text.split('\n').at(-1)).toBe(
			'Inspired by Conductor (conductor.build)',
		);
	});

	test('separates each group with a heading and a rule', () => {
		const lines = creditsText(
			strings,
			CREDITS_PACKAGES,
			'Philipp Soldunov',
		).split('\n');
		const core = lines.indexOf(strings.coreProjects);
		const development = lines.indexOf(strings.developmentTools);
		expect(core).toBeGreaterThan(0);
		expect(development).toBeGreaterThan(core);
		expect(lines[core - 1]).toBe('');
		expect(lines[core + 1]).toMatch(/^─+$/);
		expect(lines[development + 1]).toMatch(/^─+$/);
	});
});
