import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dynamicIconImports from 'lucide-react/dynamicIconImports.mjs';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
	parseToolPresentation,
	resolveToolPresentationText,
	type ToolPresentationBody,
	toolPresentationV1Schema,
} from '../../src/shared/tool-presentation';
import { LUCIDE_ICON_NAMES } from '../../src/shared/tool-presentation/lucide-icon-names.gen';

const base = { title: 'Tool result', version: 1 as const };

function withBody(body: ToolPresentationBody): Record<string, unknown> {
	return { ...base, body };
}

describe('tool presentation v1 contract', () => {
	test('accepts every native body primitive', () => {
		const bodies: ToolPresentationBody[] = [
			{ kind: 'markdown', text: { en: 'Summary', ru: 'Итог', el: 'Περίληψη' } },
			{
				kind: 'code',
				language: 'text',
				code: '/tmp/example.ts:4',
				startLine: null,
			},
			{
				kind: 'labeled',
				sections: [
					{ label: 'Result', text: { en: 'Done', ru: 'Готово', el: 'Έτοιμο' } },
				],
			},
			{ kind: 'terminal', text: '$ npm test\npass' },
			{
				kind: 'diff',
				language: 'diff',
				patch: '@@ -1 +1 @@',
				showFileNames: true,
			},
			{
				kind: 'diagnostics',
				entries: [
					{
						severity: 'warning',
						message: {
							en: 'Unused import',
							ru: 'Неиспользуемый импорт',
							el: 'Αχρησιμοποίητο import',
						},
						line: 4,
						column: 2,
						source: 'typescript',
					},
				],
			},
			{
				kind: 'checklist',
				items: [
					{
						id: 'one',
						subject: { en: 'Ship it', ru: 'Выпустить', el: 'Έκδοση' },
						status: 'completed',
						detail: 'All checks pass',
						number: '1',
					},
				],
			},
		];

		for (const body of bodies) {
			expect(parseToolPresentation(withBody(body))).not.toBeNull();
		}
	});

	test('rejects invalid versions, glyphs, and unknown fields', () => {
		expect(parseToolPresentation({ ...base, version: 2 })).toBeNull();
		expect(
			parseToolPresentation({ ...base, glyph: 'not-a-lucide-icon' }),
		).toBeNull();
		expect(parseToolPresentation({ ...base, extra: true })).toBeNull();
		expect(
			parseToolPresentation({
				...base,
				body: { kind: 'markdown', text: 'ok', extra: true },
			}),
		).toBeNull();
	});

	test('enforces descriptor, prose, body, list, and section limits', () => {
		expect(
			parseToolPresentation({
				...base,
				title: 'x'.repeat(161),
			}),
		).toBeNull();
		expect(
			parseToolPresentation({
				...base,
				preview: {
					font: 'sans',
					text: 'x'.repeat(513),
				},
			}),
		).toBeNull();
		expect(
			parseToolPresentation(
				withBody({
					kind: 'terminal',
					text: 'x'.repeat(32_769),
				}),
			),
		).toBeNull();
		expect(
			parseToolPresentation({
				...base,
				body: {
					kind: 'diagnostics',
					entries: Array.from({ length: 101 }, () => ({
						severity: 'info',
						message: 'ok',
					})),
				},
			}),
		).toBeNull();
		expect(
			parseToolPresentation({
				...base,
				body: {
					kind: 'labeled',
					sections: Array.from({ length: 17 }, () => ({
						label: 'label',
						text: 'text',
					})),
				},
			}),
		).toBeNull();
	});

	test('rejects empty and duplicate checklist item ids', () => {
		for (const ids of [[''], ['same', 'same']]) {
			expect(
				parseToolPresentation(
					withBody({
						kind: 'checklist',
						items: ids.map((id) => ({ id, status: 'pending', subject: id })),
					}),
				),
			).toBeNull();
		}
	});

	test('counts UTF-8 bytes for the serialized descriptor', () => {
		expect(
			parseToolPresentation(
				withBody({ kind: 'code', language: 'text', code: '€'.repeat(22_000) }),
			),
		).toBeNull();
	});

	test('resolves regional languages and falls back to English', () => {
		const text = { en: 'English', ru: 'Русский' };
		expect(resolveToolPresentationText(text, 'ru')).toBe('Русский');
		expect(resolveToolPresentationText(text, 'ru-RU')).toBe('Русский');
		expect(resolveToolPresentationText(text, 'el')).toBe('English');
		expect(resolveToolPresentationText('literal path.ts', 'ru')).toBe(
			'literal path.ts',
		);
	});

	test('keeps the published schema in parity with the Zod schema', () => {
		const schemaPath = fileURLToPath(
			new URL(
				'../../schemas/tool-presentation.v1.schema.json',
				import.meta.url,
			),
		);
		const published = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<
			string,
			unknown
		>;
		const generated = z.toJSONSchema(toolPresentationV1Schema, {
			io: 'input',
		}) as unknown as Record<string, unknown>;
		expect(published.$id).toBe(
			'https://www.ensemblr.dev/schemas/tool-presentation.v1.schema.json',
		);
		delete published.$id;
		expect(published).toEqual(generated);
	});

	test('accepts installed Lucide glyph ids without widening unknown metadata', () => {
		expect(
			parseToolPresentation({ ...base, glyph: 'arrow-up-right' }),
		).toMatchObject({
			glyph: 'arrow-up-right',
		});
		expect(
			parseToolPresentation({ ...base, glyph: 'audio-lines' }),
		).toMatchObject({
			glyph: 'audio-lines',
		});
		expect(
			parseToolPresentation({ ...base, glyph: 'not-a-lucide-icon' }),
		).toBeNull();
	});

	test('keeps the generated Lucide glyph set current', () => {
		expect([...LUCIDE_ICON_NAMES].sort()).toEqual(
			Object.keys(dynamicIconImports).sort(),
		);
	});
});
