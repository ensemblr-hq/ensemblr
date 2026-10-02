/**
 * Renders an `askUserQuestion` outcome as prose for the calling model. The tool
 * result is JSON, but models act on the wording far more reliably than on a
 * nested `answers` array, so every result carries a rendered summary alongside
 * the structured answers.
 */
import type {
	AskUserQuestionAnswer,
	AskUserQuestionResult,
} from './contracts.ts';

/** What the model is told when the user dismissed the dialog or answered nothing. */
const DECLINED_SUMMARY = 'The user declined to answer.';

/** Placeholder for a question the user submitted with an empty free-text row. */
const EMPTY_ANSWER = '(no input)';

/**
 * Renders one answer as `"question" = "answer"`.
 * @param answer - A single answered question.
 * @returns The rendered segment.
 */
function formatAnswer(answer: AskUserQuestionAnswer): string {
	const value =
		answer.kind === 'multi'
			? (answer.selected ?? []).join(', ')
			: (answer.answer ?? '');
	return `"${answer.question}" = "${value.trim() === '' ? EMPTY_ANSWER : value}"`;
}

/**
 * Builds the model-facing summary of an answered questionnaire.
 * @param answers - Answers collected from the user, in question order.
 * @param cancelled - Whether the user dismissed the dialog.
 * @returns Prose the model can act on directly.
 */
function formatAskUserQuestionSummary(
	answers: readonly AskUserQuestionAnswer[],
	cancelled: boolean,
): string {
	if (cancelled || answers.length === 0) {
		return DECLINED_SUMMARY;
	}
	return `The user answered: ${answers.map(formatAnswer).join('; ')}. Continue with those answers in mind and do not re-ask.`;
}

/**
 * Builds a complete result envelope with its summary already rendered. A
 * dismissed dialog reports no answers at all, so the structured payload cannot
 * contradict the decline the summary states.
 * @param answers - Answers collected from the user, in question order.
 * @param cancelled - Whether the user dismissed the dialog.
 * @returns The result the control op resolves to.
 */
export function buildAskUserQuestionResult(
	answers: readonly AskUserQuestionAnswer[],
	cancelled: boolean,
): AskUserQuestionResult {
	const kept = cancelled ? [] : answers;
	return {
		answers: kept,
		cancelled,
		summary: formatAskUserQuestionSummary(kept, cancelled),
	};
}
