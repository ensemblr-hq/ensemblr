import { describe, expect, it } from 'vitest';

import {
	createQuestionnaireState,
	routeQuestionnaireKey,
} from '@/renderer/lib/ask-user-question';
import type { QuestionnaireState } from '@/renderer/types/ask-user-question';
import type { AskUserQuestionItem } from '@/shared/agent-control';

const QUESTIONS: readonly AskUserQuestionItem[] = [
	{
		options: [{ label: 'Rewrite' }, { label: 'Patch' }, { label: 'Defer' }],
		question: 'Which approach?',
	},
	{
		options: [{ label: 'Now' }, { label: 'Later' }],
		question: 'When?',
	},
];

const idle = (): QuestionnaireState => createQuestionnaireState(QUESTIONS);

const typing = (): QuestionnaireState => ({
	...idle(),
	focusIndex: 3,
	typing: true,
});

describe('routeQuestionnaireKey', () => {
	it('cancels on Escape, even while typing', () => {
		expect(routeQuestionnaireKey({ key: 'Escape' }, idle())).toEqual({
			type: 'cancel',
		});
		expect(routeQuestionnaireKey({ key: 'Escape' }, typing())).toEqual({
			type: 'cancel',
		});
	});

	it('confirms on Enter and submits on the command modifier', () => {
		expect(routeQuestionnaireKey({ key: 'Enter' }, idle())).toEqual({
			type: 'confirm',
		});
		expect(
			routeQuestionnaireKey({ key: 'Enter', metaKey: true }, idle()),
		).toEqual({ type: 'submit' });
		expect(
			routeQuestionnaireKey({ ctrlKey: true, key: 'Enter' }, idle()),
		).toEqual({ type: 'submit' });
	});

	it('moves focus with the vertical arrows', () => {
		expect(routeQuestionnaireKey({ key: 'ArrowDown' }, idle())).toEqual({
			delta: 1,
			type: 'moveFocus',
		});
		expect(routeQuestionnaireKey({ key: 'ArrowUp' }, typing())).toEqual({
			delta: -1,
			type: 'moveFocus',
		});
	});

	it('pages with the horizontal arrows outside the free-text row', () => {
		expect(routeQuestionnaireKey({ key: 'ArrowRight' }, idle())).toEqual({
			delta: 1,
			type: 'movePage',
		});
		expect(routeQuestionnaireKey({ key: 'ArrowLeft' }, idle())).toEqual({
			delta: -1,
			type: 'movePage',
		});
	});

	it('leaves the horizontal arrows to the caret while typing', () => {
		expect(routeQuestionnaireKey({ key: 'ArrowRight' }, typing())).toBeNull();
		expect(routeQuestionnaireKey({ key: 'ArrowLeft' }, typing())).toBeNull();
	});

	it('maps digits to option rows', () => {
		expect(routeQuestionnaireKey({ key: '1' }, idle())).toEqual({
			index: 0,
			type: 'choose',
		});
		expect(routeQuestionnaireKey({ key: '3' }, idle())).toEqual({
			index: 2,
			type: 'choose',
		});
	});

	it('maps zero to the free-text row', () => {
		expect(routeQuestionnaireKey({ key: '0' }, idle())).toEqual({
			index: 3,
			type: 'choose',
		});
	});

	it('ignores a digit past the last option', () => {
		expect(routeQuestionnaireKey({ key: '4' }, idle())).toBeNull();
	});

	it('lets digits type into the free-text row', () => {
		expect(routeQuestionnaireKey({ key: '1' }, typing())).toBeNull();
		expect(routeQuestionnaireKey({ key: '0' }, typing())).toBeNull();
	});

	it('ignores plain characters and modified keys', () => {
		expect(routeQuestionnaireKey({ key: 'a' }, idle())).toBeNull();
		expect(
			routeQuestionnaireKey({ key: '1', metaKey: true }, idle()),
		).toBeNull();
		expect(
			routeQuestionnaireKey({ altKey: true, key: 'Enter' }, idle()),
		).toBeNull();
	});
});
