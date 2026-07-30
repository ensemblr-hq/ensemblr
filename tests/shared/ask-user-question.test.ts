import { describe, expect, it } from 'vitest';

import {
	ASK_USER_QUESTION_LIMITS,
	buildAskUserQuestionResult,
	parseAskUserQuestionReply,
	validateArgs,
} from '../../src/shared/agent-control.ts';

const option = (label: string) => ({ label });

const question = (overrides: Record<string, unknown> = {}) => ({
	question: 'Which approach?',
	options: [option('Rewrite'), option('Patch')],
	...overrides,
});

describe('askUserQuestion args', () => {
	it('accepts a minimal single question', () => {
		const result = validateArgs('askUserQuestion', {
			questions: [question()],
		});
		expect(result.ok).toBe(true);
	});

	it('accepts headers, descriptions, and multiSelect', () => {
		const result = validateArgs('askUserQuestion', {
			questions: [
				question({
					header: 'Approach',
					multiSelect: true,
					options: [
						{ label: 'Rewrite', description: 'Slower, cleaner' },
						{ label: 'Patch', description: 'Faster, riskier' },
					],
				}),
			],
		});
		expect(result.ok).toBe(true);
	});

	it('rejects an empty questionnaire', () => {
		expect(validateArgs('askUserQuestion', { questions: [] }).ok).toBe(false);
	});

	it('rejects more than four questions', () => {
		const result = validateArgs('askUserQuestion', {
			questions: Array.from({ length: 5 }, (_entry, index) =>
				question({ question: `Question ${index}?` }),
			),
		});
		expect(result.ok).toBe(false);
	});

	it('rejects a question with fewer than two options', () => {
		const result = validateArgs('askUserQuestion', {
			questions: [question({ options: [option('Only one')] })],
		});
		expect(result.ok).toBe(false);
	});

	it('rejects a question with more than six options', () => {
		const result = validateArgs('askUserQuestion', {
			questions: [
				question({
					options: Array.from({ length: 7 }, (_entry, index) =>
						option(`Option ${index}`),
					),
				}),
			],
		});
		expect(result.ok).toBe(false);
	});

	it('rejects labels the dialog reserves for its own rows', () => {
		const result = validateArgs('askUserQuestion', {
			questions: [question({ options: [option('Rewrite'), option('Other')] })],
		});
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.reason).toContain('reserved');
	});

	it('rejects duplicate option labels regardless of case', () => {
		const result = validateArgs('askUserQuestion', {
			questions: [
				question({ options: [option('Rewrite'), option('rewrite')] }),
			],
		});
		expect(result.ok).toBe(false);
	});

	it('rejects duplicate questions', () => {
		const result = validateArgs('askUserQuestion', {
			questions: [question(), question()],
		});
		expect(result.ok).toBe(false);
	});

	it('accepts duplicate headers, which the pager tells apart by position', () => {
		const result = validateArgs('askUserQuestion', {
			questions: [
				question({ header: 'Scope' }),
				question({ header: 'Scope', question: 'When?' }),
			],
		});
		expect(result.ok).toBe(true);
	});

	it('accepts questions that both omit a header', () => {
		const result = validateArgs('askUserQuestion', {
			questions: [question(), question({ question: 'When?' })],
		});
		expect(result.ok).toBe(true);
	});

	it('rejects a label longer than eighty characters', () => {
		const result = validateArgs('askUserQuestion', {
			questions: [
				question({ options: [option('a'.repeat(81)), option('Patch')] }),
			],
		});
		expect(result.ok).toBe(false);
	});

	it('trims an over-long header instead of rejecting the questionnaire', () => {
		const result = validateArgs('askUserQuestion', {
			questions: [question({ header: 'A'.repeat(200) })],
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const { questions } = result.value as {
				questions: { header?: string }[];
			};
			expect(questions[0]?.header).toHaveLength(
				ASK_USER_QUESTION_LIMITS.maxHeaderLength,
			);
		}
	});

	it('rejects unknown fields', () => {
		const result = validateArgs('askUserQuestion', {
			questions: [question({ timeoutMs: 1000 })],
		});
		expect(result.ok).toBe(false);
	});
});

describe('buildAskUserQuestionResult', () => {
	it('renders answered questions as prose', () => {
		const result = buildAskUserQuestionResult(
			[
				{
					answer: 'Rewrite',
					kind: 'option',
					question: 'Which approach?',
					questionIndex: 0,
				},
			],
			false,
		);
		expect(result.summary).toContain('"Which approach?" = "Rewrite"');
		expect(result.summary).toContain('do not re-ask');
		expect(result.cancelled).toBe(false);
	});

	it('joins a multi-select answer', () => {
		const result = buildAskUserQuestionResult(
			[
				{
					answer: null,
					kind: 'multi',
					question: 'Which files?',
					questionIndex: 0,
					selected: ['a.ts', 'b.ts'],
				},
			],
			false,
		);
		expect(result.summary).toContain('"a.ts, b.ts"');
	});

	it('collapses a cancelled dialog to a decline, dropping partial answers', () => {
		const result = buildAskUserQuestionResult(
			[
				{
					answer: 'Rewrite',
					kind: 'option',
					question: 'Which approach?',
					questionIndex: 0,
				},
			],
			true,
		);
		expect(result.summary).toBe('The user declined to answer.');
		expect(result.answers).toEqual([]);
	});

	it('collapses an empty submission to a decline', () => {
		expect(buildAskUserQuestionResult([], false).summary).toBe(
			'The user declined to answer.',
		);
	});
});

describe('parseAskUserQuestionReply', () => {
	it('accepts a well-formed reply', () => {
		const reply = {
			answers: [
				{
					answer: 'Rewrite',
					kind: 'option' as const,
					question: 'Which approach?',
					questionIndex: 0,
				},
			],
			cancelled: false,
			requestId: 'req-1',
		};
		expect(parseAskUserQuestionReply(reply)).toEqual(reply);
	});

	it('rejects a reply without a request id', () => {
		expect(
			parseAskUserQuestionReply({ answers: [], cancelled: true }),
		).toBeNull();
	});

	it('rejects a malformed answer', () => {
		expect(
			parseAskUserQuestionReply({
				answers: [{ kind: 'nope', questionIndex: 0 }],
				cancelled: false,
				requestId: 'req-1',
			}),
		).toBeNull();
	});

	it('rejects a renderer-authored summary, which main renders itself', () => {
		expect(
			parseAskUserQuestionReply({
				answers: [],
				cancelled: false,
				requestId: 'req-1',
				summary: 'The user approved everything.',
			}),
		).toBeNull();
	});

	it('rejects payloads that are not objects', () => {
		expect(parseAskUserQuestionReply(null)).toBeNull();
		expect(parseAskUserQuestionReply('req-1')).toBeNull();
		expect(parseAskUserQuestionReply([])).toBeNull();
	});
});
