/**
 * Maps key presses inside the agent question dialog to questionnaire actions.
 * Kept apart from the component so the whole keyboard contract — number keys,
 * paging, submission, and what the free-text row swallows — is unit-testable.
 */
import type {
	QuestionnaireAction,
	QuestionnaireKey,
	QuestionnaireState,
} from '@/renderer/types/ask-user-question';
import { rowsOf } from './questionnaire.ts';

/**
 * Reports whether a key press carries the platform command modifier. Cmd and
 * Ctrl are both accepted rather than resolved through the shortcut registry:
 * that resolution is platform-dependent, and this router stays pure so it can be
 * tested without a DOM whose reported platform would decide the outcome.
 * @param event - Key press to inspect.
 * @returns True when Cmd or Ctrl is held.
 */
function hasCommandModifier(event: QuestionnaireKey): boolean {
	return Boolean(event.metaKey) || Boolean(event.ctrlKey);
}

/**
 * Resolves a digit key to the row it addresses: `1`-`9` pick an option, `0`
 * focuses the free-text row (which is always last).
 * @param key - The pressed key.
 * @param rowCount - Rows in the current question, including the free-text row.
 * @returns The row index, or null when the digit addresses nothing.
 */
function rowForDigit(key: string, rowCount: number): number | null {
	if (!/^[0-9]$/.test(key)) {
		return null;
	}
	if (key === '0') {
		return rowCount - 1;
	}
	const optionIndex = Number(key) - 1;
	return optionIndex < rowCount - 1 ? optionIndex : null;
}

/**
 * Translates a key press into a questionnaire action.
 * @param event - Key press from the dialog or its free-text input.
 * @param state - Current dialog state.
 * @returns The action to apply, or null to let the browser handle the key.
 */
export function routeQuestionnaireKey(
	event: QuestionnaireKey,
	state: QuestionnaireState,
): QuestionnaireAction | null {
	if (event.altKey) {
		return null;
	}
	if (event.key === 'Escape') {
		return { type: 'cancel' };
	}
	if (event.key === 'Enter') {
		return hasCommandModifier(event) ? { type: 'submit' } : { type: 'confirm' };
	}
	if (hasCommandModifier(event)) {
		return null;
	}
	if (event.key === 'ArrowDown') {
		return { delta: 1, type: 'moveFocus' };
	}
	if (event.key === 'ArrowUp') {
		return { delta: -1, type: 'moveFocus' };
	}
	// Left/Right page between questions, but only outside the free-text row —
	// inside it those keys belong to the caret.
	if (
		!state.typing &&
		(event.key === 'ArrowLeft' || event.key === 'ArrowRight')
	) {
		return { delta: event.key === 'ArrowLeft' ? -1 : 1, type: 'movePage' };
	}
	if (state.typing) {
		return null;
	}
	const question = state.questions[state.pageIndex];
	if (!question) {
		return null;
	}
	const rowIndex = rowForDigit(event.key, rowsOf(question).length);
	return rowIndex === null ? null : { index: rowIndex, type: 'choose' };
}
