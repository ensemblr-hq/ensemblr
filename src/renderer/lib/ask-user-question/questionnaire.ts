/**
 * Pure state model behind the agent question dialog. The component renders this
 * and feeds it actions; nothing here touches React or the DOM, so the whole
 * interaction — focus, selection, free text, paging, submission — is testable in
 * isolation.
 */
import type {
	QuestionnaireAction,
	QuestionnaireRow,
	QuestionnaireState,
	QuestionnaireTransition,
} from '@/renderer/types/ask-user-question';
import type {
	AskUserQuestionAnswer,
	AskUserQuestionItem,
} from '@/shared/agent-control';

/**
 * Builds the initial dialog state for a questionnaire.
 * @param questions - Questions the agent asked, in order.
 * @returns State focused on the first option of the first question.
 */
export function createQuestionnaireState(
	questions: readonly AskUserQuestionItem[],
): QuestionnaireState {
	return {
		answers: {},
		checked: {},
		drafts: {},
		focusIndex: 0,
		pageIndex: 0,
		questions,
		typing: false,
	};
}

/**
 * Lists the focusable rows of a question: its options, then the free-text row.
 * @param question - Question to project.
 * @returns Rows in display order.
 */
export function rowsOf(
	question: AskUserQuestionItem,
): readonly QuestionnaireRow[] {
	const options = question.options.map(
		(option, index): QuestionnaireRow => ({
			description: option.description ?? null,
			kind: 'option',
			label: option.label,
			number: index + 1,
		}),
	);
	return [
		...options,
		{ description: null, kind: 'freeText', label: '', number: 0 },
	];
}

/**
 * Builds the accessible name for a question's pager dot. The position leads so
 * every dot is distinct whatever the agent supplied — which is why the contract
 * no longer asks agents to keep their headers unique.
 * @param question - Question to label.
 * @param index - Its position in the questionnaire.
 * @returns `Q<n>`, followed by the agent's header when it sent one.
 */
export function headerOf(question: AskUserQuestionItem, index: number): string {
	const position = `Q${index + 1}`;
	return question.header === undefined
		? position
		: `${position}: ${question.header}`;
}

/**
 * Reports whether a question already has a recorded answer.
 * @param state - Current dialog state.
 * @param index - Question index to check.
 * @returns True when the question is answered.
 */
export function isAnswered(state: QuestionnaireState, index: number): boolean {
	return state.answers[index] !== undefined;
}

/**
 * Wraps an index into a range, so focus and paging cycle instead of sticking.
 * @param value - Candidate index, possibly out of range.
 * @param length - Range size.
 * @returns The wrapped index.
 */
function wrap(value: number, length: number): number {
	return ((value % length) + length) % length;
}

/**
 * Reads the current question's free-text draft.
 * @param state - Current dialog state.
 * @returns The draft, or an empty string when none was typed.
 */
function draftOf(state: QuestionnaireState): string {
	return state.drafts[state.pageIndex] ?? '';
}

/**
 * Replaces one question's answer, dropping the entry when `answer` is null.
 * @param answers - Current answer map.
 * @param index - Question index to write.
 * @param answer - The new answer, or null to clear it.
 * @returns A new answer map.
 */
function withAnswer(
	answers: Readonly<Record<number, AskUserQuestionAnswer>>,
	index: number,
	answer: AskUserQuestionAnswer | null,
): Readonly<Record<number, AskUserQuestionAnswer>> {
	const next = { ...answers };
	if (answer === null) {
		delete next[index];
	} else {
		next[index] = answer;
	}
	return next;
}

/**
 * Moves to a question, resetting per-question focus and typing state.
 * @param state - Current dialog state.
 * @param pageIndex - Question to show.
 * @returns The state showing that question.
 */
function showPage(
	state: QuestionnaireState,
	pageIndex: number,
): QuestionnaireState {
	return { ...state, focusIndex: 0, pageIndex, typing: false };
}

/**
 * Advances past a just-answered question, or reports that it was the last one.
 * @param state - State with the answer already recorded.
 * @returns The transition: the next page, or a submission.
 */
function advance(state: QuestionnaireState): QuestionnaireTransition {
	const nextPage = state.pageIndex + 1;
	if (nextPage >= state.questions.length) {
		return { outcome: 'submitted', state };
	}
	return { outcome: 'open', state: showPage(state, nextPage) };
}

/**
 * Records the free-text draft as the current question's answer.
 * @param state - Current dialog state.
 * @returns The transition, unchanged when the draft is blank.
 */
function confirmFreeText(state: QuestionnaireState): QuestionnaireTransition {
	const text = draftOf(state).trim();
	if (text === '') {
		return { outcome: 'open', state };
	}
	const question = state.questions[state.pageIndex];
	if (!question) {
		return { outcome: 'open', state };
	}
	const checked = { ...state.checked };
	delete checked[state.pageIndex];
	return advance({
		...state,
		answers: withAnswer(state.answers, state.pageIndex, {
			answer: text,
			kind: 'custom',
			question: question.question,
			questionIndex: state.pageIndex,
		}),
		checked,
	});
}

/**
 * Records a single-select choice as the current question's answer.
 * @param state - Current dialog state.
 * @param label - Chosen option label.
 * @returns The transition, advancing past the answered question.
 */
function confirmOption(
	state: QuestionnaireState,
	label: string,
): QuestionnaireTransition {
	const question = state.questions[state.pageIndex];
	if (!question) {
		return { outcome: 'open', state };
	}
	const drafts = { ...state.drafts };
	delete drafts[state.pageIndex];
	return advance({
		...state,
		answers: withAnswer(state.answers, state.pageIndex, {
			answer: label,
			kind: 'option',
			question: question.question,
			questionIndex: state.pageIndex,
		}),
		drafts,
	});
}

/**
 * Toggles a multi-select option, keeping the recorded answer in step so the
 * pager reflects the question as answered while the user is still checking boxes.
 * @param state - Current dialog state.
 * @param label - Option label to toggle.
 * @returns The state with the option flipped.
 */
function toggleOption(
	state: QuestionnaireState,
	label: string,
): QuestionnaireState {
	const question = state.questions[state.pageIndex];
	if (!question) {
		return state;
	}
	const current = state.checked[state.pageIndex] ?? [];
	const currentSet = new Set(current);
	const selected = currentSet.has(label)
		? current.filter((entry) => entry !== label)
		: question.options.flatMap((option) =>
				option.label === label || currentSet.has(option.label)
					? [option.label]
					: [],
			);
	const drafts = { ...state.drafts };
	delete drafts[state.pageIndex];
	return {
		...state,
		answers: withAnswer(
			state.answers,
			state.pageIndex,
			selected.length === 0
				? null
				: {
						answer: null,
						kind: 'multi',
						question: question.question,
						questionIndex: state.pageIndex,
						selected,
					},
		),
		checked: { ...state.checked, [state.pageIndex]: selected },
		drafts,
	};
}

/**
 * Confirms whichever row is focused: a choice, a toggle, or the typed answer.
 * @param state - Current dialog state.
 * @param rowIndex - Row to act on.
 * @returns The resulting transition.
 */
function commitRow(
	state: QuestionnaireState,
	rowIndex: number,
): QuestionnaireTransition {
	const question = state.questions[state.pageIndex];
	if (!question) {
		return { outcome: 'open', state };
	}
	const row = rowsOf(question)[rowIndex];
	if (!row) {
		return { outcome: 'open', state };
	}
	if (row.kind === 'freeText') {
		return {
			outcome: 'open',
			state: { ...state, focusIndex: rowIndex, typing: true },
		};
	}
	if (question.multiSelect) {
		return {
			outcome: 'open',
			state: toggleOption(
				{ ...state, focusIndex: rowIndex, typing: false },
				row.label,
			),
		};
	}
	return confirmOption(
		{ ...state, focusIndex: rowIndex, typing: false },
		row.label,
	);
}

/**
 * Folds every unconfirmed free-text draft into the answers, so an explicit
 * submit does not silently discard text the user can still see on screen.
 * @param state - Current dialog state.
 * @returns The state with pending drafts recorded.
 */
function commitPendingDrafts(state: QuestionnaireState): QuestionnaireState {
	const pending = state.questions.flatMap(
		(question, index): readonly AskUserQuestionAnswer[] => {
			const text = (state.drafts[index] ?? '').trim();
			if (text === '' || state.answers[index]) {
				return [];
			}
			return [
				{
					answer: text,
					kind: 'custom',
					question: question.question,
					questionIndex: index,
				},
			];
		},
	);
	if (pending.length === 0) {
		return state;
	}
	return {
		...state,
		answers: {
			...state.answers,
			...Object.fromEntries(
				pending.map((answer) => [answer.questionIndex, answer]),
			),
		},
	};
}

/**
 * Applies an action to the dialog state.
 * @param state - Current dialog state.
 * @param action - Action from a key press or pointer interaction.
 * @returns The next state and whether the dialog finished.
 */
export function applyQuestionnaireAction(
	state: QuestionnaireState,
	action: QuestionnaireAction,
): QuestionnaireTransition {
	const question = state.questions[state.pageIndex];
	const rowCount = question ? rowsOf(question).length : 0;
	switch (action.type) {
		case 'focusRow': {
			if (rowCount === 0) {
				return { outcome: 'open', state };
			}
			const focusIndex = wrap(action.index, rowCount);
			return {
				outcome: 'open',
				state: { ...state, focusIndex, typing: focusIndex === rowCount - 1 },
			};
		}
		case 'moveFocus':
			return applyQuestionnaireAction(state, {
				index: state.focusIndex + action.delta,
				type: 'focusRow',
			});
		case 'choose':
			return commitRow(state, action.index);
		case 'confirm':
			return state.typing
				? confirmFreeText(state)
				: commitRow(state, state.focusIndex);
		case 'draft':
			return {
				outcome: 'open',
				state: {
					...state,
					drafts: { ...state.drafts, [state.pageIndex]: action.value },
				},
			};
		case 'goToPage': {
			if (state.questions.length === 0) {
				return { outcome: 'open', state };
			}
			return {
				outcome: 'open',
				state: showPage(state, wrap(action.index, state.questions.length)),
			};
		}
		case 'movePage':
			return applyQuestionnaireAction(state, {
				index: state.pageIndex + action.delta,
				type: 'goToPage',
			});
		case 'submit':
			return { outcome: 'submitted', state: commitPendingDrafts(state) };
		case 'cancel':
			return { outcome: 'cancelled', state };
	}
}

/**
 * Collects the recorded answers in question order, skipping unanswered ones.
 * @param state - Dialog state to read.
 * @returns Answers ready for the agent-control reply.
 */
export function collectAnswers(
	state: QuestionnaireState,
): readonly AskUserQuestionAnswer[] {
	return state.questions
		.map((_question, index) => state.answers[index])
		.filter((answer): answer is AskUserQuestionAnswer => answer !== undefined);
}
