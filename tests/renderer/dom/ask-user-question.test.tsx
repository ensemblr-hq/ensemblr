// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { expect, test, vi } from 'vitest';

import { AskUserQuestionCard } from '@/renderer/components/ask-user-question';
import type { AskUserQuestionItem } from '@/shared/agent-control';
import { renderWithProviders } from '../support/dom';

const SINGLE: readonly AskUserQuestionItem[] = [
	{
		options: [
			{ description: 'Slower, cleaner', label: 'Rewrite it' },
			{ label: 'Patch it' },
		],
		question: 'Which approach should I take?',
	},
];

const TWO_QUESTIONS: readonly AskUserQuestionItem[] = [
	{
		header: 'Scope',
		options: [{ label: 'Main process' }, { label: 'Renderer UI' }],
		question: 'Which part of the codebase?',
	},
	{
		options: [{ label: 'Now' }, { label: 'Later' }],
		question: 'When should I do it?',
	},
];

const MULTI_SELECT: readonly AskUserQuestionItem[] = [
	{
		multiSelect: true,
		options: [{ label: 'a.ts' }, { label: 'b.ts' }],
		question: 'Which files?',
	},
];

const renderCard = (questions: readonly AskUserQuestionItem[]) => {
	const onFinish = vi.fn();
	renderWithProviders(
		<AskUserQuestionCard onFinish={onFinish} questions={questions} />,
	);
	return { onFinish, user: userEvent.setup() };
};

test('renders the question, its numbered options, and the free-text row', () => {
	renderCard(SINGLE);
	expect(
		screen.getByRole('heading', { name: 'Which approach should I take?' }),
	).toBeInTheDocument();
	expect(screen.getByText('Rewrite it')).toBeInTheDocument();
	expect(screen.getByText('Slower, cleaner')).toBeInTheDocument();
	expect(screen.getByText('1')).toBeInTheDocument();
	expect(screen.getByText('2')).toBeInTheDocument();
	expect(screen.getByText('0')).toBeInTheDocument();
	expect(screen.getByPlaceholderText('Type something…')).toBeInTheDocument();
});

test('answers with a click on an option', async () => {
	const { onFinish, user } = renderCard(SINGLE);
	await user.click(screen.getByText('Patch it'));
	expect(onFinish).toHaveBeenCalledWith({
		answers: [
			{
				answer: 'Patch it',
				kind: 'option',
				question: 'Which approach should I take?',
				questionIndex: 0,
			},
		],
		cancelled: false,
	});
});

test('answers with a number key', async () => {
	const { onFinish, user } = renderCard(SINGLE);
	await user.keyboard('1');
	expect(onFinish).toHaveBeenCalledWith({
		answers: [
			expect.objectContaining({ answer: 'Rewrite it', kind: 'option' }),
		],
		cancelled: false,
	});
});

test('types a free-text answer after pressing zero', async () => {
	const { onFinish, user } = renderCard(SINGLE);
	await user.keyboard('0');
	expect(screen.getByPlaceholderText('Type something…')).toHaveFocus();
	await user.keyboard('neither{Enter}');
	expect(onFinish).toHaveBeenCalledWith({
		answers: [expect.objectContaining({ answer: 'neither', kind: 'custom' })],
		cancelled: false,
	});
});

test('cancels when the dismiss button is pressed', async () => {
	const { onFinish, user } = renderCard(SINGLE);
	await user.click(screen.getByRole('button', { name: 'Dismiss question' }));
	expect(onFinish).toHaveBeenCalledWith({ answers: [], cancelled: true });
});

test('cancels on Escape', async () => {
	const { onFinish, user } = renderCard(SINGLE);
	await user.keyboard('{Escape}');
	expect(onFinish).toHaveBeenCalledWith({ answers: [], cancelled: true });
});

test('walks through several questions before finishing', async () => {
	const { onFinish, user } = renderCard(TWO_QUESTIONS);
	expect(screen.getByRole('button', { name: 'Scope' })).toBeInTheDocument();
	await user.keyboard('2');
	expect(
		screen.getByRole('heading', { name: 'When should I do it?' }),
	).toBeInTheDocument();
	expect(onFinish).not.toHaveBeenCalled();
	await user.keyboard('1');
	expect(onFinish).toHaveBeenCalledWith({
		answers: [
			expect.objectContaining({ answer: 'Renderer UI' }),
			expect.objectContaining({ answer: 'Now' }),
		],
		cancelled: false,
	});
});

test('pages back to an earlier question with the pager', async () => {
	const { user } = renderCard(TWO_QUESTIONS);
	await user.click(screen.getByRole('button', { name: 'Next question' }));
	expect(
		screen.getByRole('heading', { name: 'When should I do it?' }),
	).toBeInTheDocument();
	await user.click(screen.getByRole('button', { name: 'Previous question' }));
	expect(
		screen.getByRole('heading', { name: 'Which part of the codebase?' }),
	).toBeInTheDocument();
});

test('submits a partial questionnaire from the submit button', async () => {
	const { onFinish, user } = renderCard(TWO_QUESTIONS);
	await user.keyboard('1');
	await user.click(screen.getByRole('button', { name: 'Submit answers' }));
	expect(onFinish).toHaveBeenLastCalledWith({
		answers: [expect.objectContaining({ answer: 'Main process' })],
		cancelled: false,
	});
});

test('submits everything answered so far on the command modifier', async () => {
	const { onFinish, user } = renderCard(TWO_QUESTIONS);
	await user.keyboard('1');
	await user.keyboard('{Meta>}{Enter}{/Meta}');
	expect(onFinish).toHaveBeenLastCalledWith({
		answers: [expect.objectContaining({ answer: 'Main process' })],
		cancelled: false,
	});
});

test('submits from the keyboard once the submit button has focus', async () => {
	const { onFinish, user } = renderCard(TWO_QUESTIONS);
	await user.keyboard('1');
	screen.getByRole('button', { name: 'Submit answers' }).focus();
	await user.keyboard('{Enter}');
	expect(onFinish).toHaveBeenLastCalledWith({
		answers: [expect.objectContaining({ answer: 'Main process' })],
		cancelled: false,
	});
});

test('dismisses from the keyboard once the dismiss button has focus', async () => {
	const { onFinish, user } = renderCard(SINGLE);
	screen.getByRole('button', { name: 'Dismiss question' }).focus();
	await user.keyboard('{Enter}');
	expect(onFinish).toHaveBeenCalledWith({ answers: [], cancelled: true });
});

test('advertises the submit chord when Enter alone cannot finish', () => {
	renderCard(TWO_QUESTIONS);
	expect(screen.getByText(/submit/)).toBeInTheDocument();
});

test('leaves the submit chord out of a single-answer question', () => {
	renderCard(SINGLE);
	expect(screen.queryByText(/submit/)).not.toBeInTheDocument();
});

test('collects several checked options before submitting', async () => {
	const { onFinish, user } = renderCard(MULTI_SELECT);
	await user.keyboard('1');
	await user.keyboard('2');
	expect(onFinish).not.toHaveBeenCalled();
	await user.click(screen.getByRole('button', { name: 'Submit answers' }));
	expect(onFinish).toHaveBeenCalledWith({
		answers: [
			expect.objectContaining({ kind: 'multi', selected: ['a.ts', 'b.ts'] }),
		],
		cancelled: false,
	});
});

test('arrowing away from a clicked row retargets Enter to the focused row', async () => {
	const { user } = renderCard(MULTI_SELECT);
	await user.click(screen.getByText('a.ts'));
	await user.keyboard('{ArrowDown}');
	await user.keyboard('{Enter}');
	expect(screen.getByText('a.ts').closest('button')).toHaveAttribute(
		'aria-pressed',
		'true',
	);
	expect(screen.getByText('b.ts').closest('button')).toHaveAttribute(
		'aria-pressed',
		'true',
	);
});

test('marks the confirmed single-select option for assistive tech', async () => {
	const { user } = renderCard(TWO_QUESTIONS);
	await user.keyboard('1');
	await user.keyboard('{ArrowLeft}');
	expect(screen.getByText('Main process').closest('button')).toHaveAttribute(
		'aria-pressed',
		'true',
	);
	expect(screen.getByText('Renderer UI').closest('button')).toHaveAttribute(
		'aria-pressed',
		'false',
	);
});

test('reports a finish exactly once under StrictMode', async () => {
	const onFinish = vi.fn();
	renderWithProviders(
		<StrictMode>
			<AskUserQuestionCard onFinish={onFinish} questions={SINGLE} />
		</StrictMode>,
	);
	await userEvent.setup().keyboard('1');
	expect(onFinish).toHaveBeenCalledTimes(1);
});
