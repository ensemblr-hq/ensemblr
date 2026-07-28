import { describe, expect, it } from 'vitest';

import {
	applyQuestionnaireAction,
	collectAnswers,
	createQuestionnaireState,
	headerOf,
	isAnswered,
	rowsOf,
} from '@/renderer/lib/ask-user-question';
import type {
	QuestionnaireAction,
	QuestionnaireState,
} from '@/renderer/types/ask-user-question';
import type { AskUserQuestionItem } from '@/shared/agent-control';

const SINGLE: readonly AskUserQuestionItem[] = [
	{
		options: [{ label: 'Rewrite' }, { label: 'Patch' }],
		question: 'Which approach?',
	},
];

const MULTI_QUESTION: readonly AskUserQuestionItem[] = [
	{
		header: 'Scope',
		options: [{ label: 'Main' }, { label: 'Renderer' }],
		question: 'Which part?',
	},
	{
		options: [{ label: 'Now' }, { label: 'Later' }],
		question: 'When?',
	},
];

const MULTI_SELECT: readonly AskUserQuestionItem[] = [
	{
		multiSelect: true,
		options: [{ label: 'a.ts' }, { label: 'b.ts' }, { label: 'c.ts' }],
		question: 'Which files?',
	},
];

/** Folds a sequence of actions over a fresh state and returns the last transition. */
const run = (
	questions: readonly AskUserQuestionItem[],
	actions: readonly QuestionnaireAction[],
) =>
	actions.reduce<{ state: QuestionnaireState; outcome: string }>(
		(carried, action) => applyQuestionnaireAction(carried.state, action),
		{ outcome: 'open', state: createQuestionnaireState(questions) },
	);

describe('rows', () => {
	it('numbers options from one and the free-text row zero', () => {
		const rows = rowsOf(SINGLE[0] as AskUserQuestionItem);
		expect(rows.map((row) => row.number)).toEqual([1, 2, 0]);
		expect(rows.at(-1)?.kind).toBe('freeText');
	});

	it('falls back to a Q-prefixed pager label', () => {
		expect(headerOf(MULTI_QUESTION[0] as AskUserQuestionItem, 0)).toBe('Scope');
		expect(headerOf(MULTI_QUESTION[1] as AskUserQuestionItem, 1)).toBe('Q2');
	});
});

describe('single select', () => {
	it('records the chosen option and submits on the last question', () => {
		const { outcome, state } = run(SINGLE, [{ index: 0, type: 'choose' }]);
		expect(outcome).toBe('submitted');
		expect(collectAnswers(state)).toEqual([
			{
				answer: 'Rewrite',
				kind: 'option',
				question: 'Which approach?',
				questionIndex: 0,
			},
		]);
	});

	it('confirms whichever row has focus', () => {
		const { state } = run(SINGLE, [
			{ delta: 1, type: 'moveFocus' },
			{ type: 'confirm' },
		]);
		expect(collectAnswers(state)[0]?.answer).toBe('Patch');
	});

	it('advances to the next question instead of submitting', () => {
		const { outcome, state } = run(MULTI_QUESTION, [
			{ index: 0, type: 'choose' },
		]);
		expect(outcome).toBe('open');
		expect(state.pageIndex).toBe(1);
		expect(state.focusIndex).toBe(0);
	});

	it('submits after the last question is answered', () => {
		const { outcome, state } = run(MULTI_QUESTION, [
			{ index: 0, type: 'choose' },
			{ index: 1, type: 'choose' },
		]);
		expect(outcome).toBe('submitted');
		expect(collectAnswers(state).map((answer) => answer.answer)).toEqual([
			'Main',
			'Later',
		]);
	});

	it('replaces an earlier answer when the question is revisited', () => {
		const { state } = run(MULTI_QUESTION, [
			{ index: 0, type: 'choose' },
			{ index: 0, type: 'goToPage' },
			{ index: 1, type: 'choose' },
		]);
		expect(collectAnswers(state)).toEqual([
			{
				answer: 'Renderer',
				kind: 'option',
				question: 'Which part?',
				questionIndex: 0,
			},
		]);
	});
});

describe('free text', () => {
	it('starts typing when the free-text row is chosen', () => {
		const { state } = run(SINGLE, [{ index: 2, type: 'choose' }]);
		expect(state.typing).toBe(true);
		expect(state.focusIndex).toBe(2);
	});

	it('records typed text as a custom answer', () => {
		const { outcome, state } = run(SINGLE, [
			{ index: 2, type: 'choose' },
			{ type: 'draft', value: '  Do neither  ' },
			{ type: 'confirm' },
		]);
		expect(outcome).toBe('submitted');
		expect(collectAnswers(state)).toEqual([
			{
				answer: 'Do neither',
				kind: 'custom',
				question: 'Which approach?',
				questionIndex: 0,
			},
		]);
	});

	it('ignores a confirm on a blank draft', () => {
		const { outcome, state } = run(SINGLE, [
			{ index: 2, type: 'choose' },
			{ type: 'draft', value: '   ' },
			{ type: 'confirm' },
		]);
		expect(outcome).toBe('open');
		expect(collectAnswers(state)).toEqual([]);
	});

	it('replaces a chosen option with typed text', () => {
		const { state } = run(MULTI_QUESTION, [
			{ index: 0, type: 'choose' },
			{ index: 0, type: 'goToPage' },
			{ index: 2, type: 'choose' },
			{ type: 'draft', value: 'Both' },
			{ type: 'confirm' },
		]);
		expect(collectAnswers(state)[0]).toMatchObject({
			answer: 'Both',
			kind: 'custom',
		});
	});

	it('folds an unconfirmed draft into an explicit submit', () => {
		const { outcome, state } = run(MULTI_QUESTION, [
			{ index: 2, type: 'choose' },
			{ type: 'draft', value: 'Something else' },
			{ type: 'submit' },
		]);
		expect(outcome).toBe('submitted');
		expect(collectAnswers(state)).toEqual([
			{
				answer: 'Something else',
				kind: 'custom',
				question: 'Which part?',
				questionIndex: 0,
			},
		]);
	});
});

describe('multi select', () => {
	it('accumulates checked options in option order', () => {
		const { outcome, state } = run(MULTI_SELECT, [
			{ index: 2, type: 'choose' },
			{ index: 0, type: 'choose' },
		]);
		expect(outcome).toBe('open');
		expect(collectAnswers(state)).toEqual([
			{
				answer: null,
				kind: 'multi',
				question: 'Which files?',
				questionIndex: 0,
				selected: ['a.ts', 'c.ts'],
			},
		]);
	});

	it('clears the answer when the last option is unchecked', () => {
		const { state } = run(MULTI_SELECT, [
			{ index: 0, type: 'choose' },
			{ index: 0, type: 'choose' },
		]);
		expect(collectAnswers(state)).toEqual([]);
		expect(isAnswered(state, 0)).toBe(false);
	});

	it('drops the checked set when typed text answers the question', () => {
		const { state } = run(MULTI_SELECT, [
			{ index: 0, type: 'choose' },
			{ index: 3, type: 'choose' },
			{ type: 'draft', value: 'None of them' },
			{ type: 'confirm' },
		]);
		expect(collectAnswers(state)).toEqual([
			{
				answer: 'None of them',
				kind: 'custom',
				question: 'Which files?',
				questionIndex: 0,
			},
		]);
	});
});

describe('navigation', () => {
	it('wraps focus at both ends', () => {
		const up = run(SINGLE, [{ delta: -1, type: 'moveFocus' }]);
		expect(up.state.focusIndex).toBe(2);
		const down = run(SINGLE, [
			{ delta: -1, type: 'moveFocus' },
			{ delta: 1, type: 'moveFocus' },
		]);
		expect(down.state.focusIndex).toBe(0);
	});

	it('marks the free-text row as typing when focus lands on it', () => {
		const { state } = run(SINGLE, [{ delta: -1, type: 'moveFocus' }]);
		expect(state.typing).toBe(true);
	});

	it('wraps paging across questions', () => {
		const { state } = run(MULTI_QUESTION, [{ delta: -1, type: 'movePage' }]);
		expect(state.pageIndex).toBe(1);
	});

	it('keeps drafts per question when paging away and back', () => {
		const { state } = run(MULTI_QUESTION, [
			{ index: 2, type: 'choose' },
			{ type: 'draft', value: 'draft one' },
			{ delta: 1, type: 'movePage' },
			{ delta: -1, type: 'movePage' },
		]);
		expect(state.drafts[0]).toBe('draft one');
		expect(state.typing).toBe(false);
	});
});

describe('finishing', () => {
	it('cancels with the answers gathered so far', () => {
		const { outcome, state } = run(MULTI_QUESTION, [
			{ index: 0, type: 'choose' },
			{ type: 'cancel' },
		]);
		expect(outcome).toBe('cancelled');
		expect(collectAnswers(state)).toHaveLength(1);
	});

	it('submits a partial questionnaire', () => {
		const { outcome, state } = run(MULTI_QUESTION, [
			{ delta: 1, type: 'movePage' },
			{ index: 0, type: 'choose' },
			{ type: 'submit' },
		]);
		expect(outcome).toBe('submitted');
		expect(collectAnswers(state)).toEqual([
			{
				answer: 'Now',
				kind: 'option',
				question: 'When?',
				questionIndex: 1,
			},
		]);
	});

	it('never mutates the state it was handed', () => {
		const initial = createQuestionnaireState(MULTI_QUESTION);
		const snapshot = JSON.stringify(initial);
		applyQuestionnaireAction(initial, { index: 0, type: 'choose' });
		expect(JSON.stringify(initial)).toBe(snapshot);
	});
});
