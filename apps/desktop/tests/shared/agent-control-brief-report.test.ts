import { describe, expect, it } from 'vitest';

import { BRIEF_REPORT_CHARS, briefReport } from '@/shared/agent-control';

const SESSION = 'child-1';

/**
 * Strips the recovery pointer so a case can measure only the report text the
 * short form actually kept.
 */
const keptText = (brief: { text: string | null }): string =>
	(brief.text ?? '').split('\n\n… report shortened')[0] ?? '';

/** A heading followed by an unbroken bullet list — the shape the playbooks ask children to write. */
const HEADING_AND_BULLETS = `## Findings\n\n${'- a finding worth reading\n'.repeat(120)}`;

/** A heading followed by one long unbroken paragraph. */
const HEADING_AND_PARAGRAPH = `## Summary\n\n${'s'.repeat(3_400)}`;

/** A report whose only paragraph break is the blank line it opens with. */
const LEADING_BLANK_LINE = `\n\n${'t'.repeat(3_400)}`;

/** A report split into many paragraphs, where a paragraph boundary is worth cutting on. */
const MANY_PARAGRAPHS = `${'p'.repeat(300)}\n\n`.repeat(10);

describe('briefReport', () => {
	it('leaves a report inside the budget untouched', () => {
		const short = 'Found it in src/main/main.ts:42.';
		expect(briefReport(short, SESSION)).toEqual({
			text: short,
			truncated: false,
		});
	});

	it('leaves a child that filed no report as null', () => {
		expect(briefReport(null, SESSION)).toEqual({
			text: null,
			truncated: false,
		});
	});

	it('keeps the answer, spends the budget on evidence, and names how to recover the rest', () => {
		const answer = 'The loader reads `settings.toml` at startup.';
		const report = `${answer}\n\n${'evidence line\n'.repeat(200)}`;
		const brief = briefReport(report, SESSION);
		expect(brief.truncated).toBe(true);
		expect(brief.text).toContain(answer);
		expect(brief.text).toContain('evidence line');
		expect(brief.text).toContain('ensemblr_get_last_message');
		expect(brief.text).toContain(SESSION);
		expect(keptText(brief).length).toBeGreaterThan(BRIEF_REPORT_CHARS * 0.9);
		expect((brief.text ?? '').length).toBeLessThan(report.length);
	});

	it('spends the budget on a heading followed by an unbroken bullet list', () => {
		const brief = briefReport(HEADING_AND_BULLETS, SESSION);
		expect(brief.truncated).toBe(true);
		expect(keptText(brief).length).toBeGreaterThan(BRIEF_REPORT_CHARS * 0.9);
		expect(brief.text).toContain('a finding worth reading');
	});

	it('spends the budget on a heading followed by one long paragraph', () => {
		const brief = briefReport(HEADING_AND_PARAGRAPH, SESSION);
		expect(brief.truncated).toBe(true);
		expect(keptText(brief).length).toBeGreaterThan(BRIEF_REPORT_CHARS * 0.9);
		expect(brief.text).toContain('## Summary');
	});

	it('spends the budget on a report that opens with a blank line', () => {
		const brief = briefReport(LEADING_BLANK_LINE, SESSION);
		expect(brief.truncated).toBe(true);
		expect(keptText(brief).length).toBeGreaterThan(BRIEF_REPORT_CHARS * 0.9);
		expect(brief.text).toContain('t'.repeat(100));
	});

	it('still cuts a many-paragraph report on a paragraph boundary', () => {
		const brief = briefReport(MANY_PARAGRAPHS, SESSION);
		const kept = keptText(brief);
		expect(brief.truncated).toBe(true);
		expect(kept).toBe(`${'p'.repeat(300)}\n\n`.repeat(2) + 'p'.repeat(300));
		expect(kept.length).toBeGreaterThan(BRIEF_REPORT_CHARS / 2);
	});

	it('cuts at a paragraph break rather than mid-sentence', () => {
		const paragraph = `${'a'.repeat(500)}\n\n`;
		const brief = briefReport(paragraph.repeat(4), SESSION, 1_100);
		expect(keptText(brief)).toBe(`${'a'.repeat(500)}\n\n${'a'.repeat(500)}`);
	});

	it('falls back to a line break when the report has no paragraphs', () => {
		const brief = briefReport(`${'line\n'.repeat(400)}`, SESSION);
		expect(brief.truncated).toBe(true);
		expect((brief.text ?? '').startsWith('line\nline\n')).toBe(true);
		expect(keptText(brief).length).toBeGreaterThan(BRIEF_REPORT_CHARS * 0.9);
	});

	it('respects the shared default budget', () => {
		const brief = briefReport('x'.repeat(BRIEF_REPORT_CHARS + 1), SESSION);
		expect(brief.truncated).toBe(true);
		expect(briefReport('x'.repeat(BRIEF_REPORT_CHARS), SESSION).truncated).toBe(
			false,
		);
	});
});
