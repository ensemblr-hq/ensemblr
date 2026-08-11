/**
 * Drives one agent question dialog: holds the pure questionnaire state, routes
 * key presses into it, keeps the caret on the free-text row when that row is
 * active, and reports the collected answers once the user finishes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
	applyQuestionnaireAction,
	collectAnswers,
	createQuestionnaireState,
	routeQuestionnaireKey,
} from '@/renderer/lib/ask-user-question';
import type {
	QuestionnaireAction,
	QuestionnaireState,
} from '@/renderer/types/ask-user-question';
import type {
	AskUserQuestionAnswer,
	AskUserQuestionItem,
} from '@/shared/agent-control';

/**
 * Reports whether the browser should activate a focused button itself. Row
 * focus inside the dialog is virtual — the shell keeps DOM focus — so Enter is
 * normally the dialog's to route. Once the user tabs onto a real control, an
 * unmodified Enter or Space belongs to that control instead.
 * @param event - Key press seen by the dialog shell.
 * @returns True when the press should reach the focused button as a click.
 */
function activatesFocusedButton(event: React.KeyboardEvent): boolean {
	if (event.key !== 'Enter' && event.key !== ' ') {
		return false;
	}
	if (event.metaKey || event.ctrlKey || event.altKey) {
		return false;
	}
	return event.target instanceof HTMLButtonElement;
}

/** What {@link useQuestionnaire} hands back to the dialog component. */
interface Questionnaire {
	state: QuestionnaireState;
	/** Applies an action from a pointer interaction. */
	run: (action: QuestionnaireAction) => void;
	/** `onKeyDown` for the dialog shell and its free-text input. */
	handleKeyDown: (event: React.KeyboardEvent) => void;
	/** Attach to the free-text input so focus can follow the active row. */
	inputRef: React.RefObject<HTMLInputElement | null>;
	/** Attach to the dialog shell; it holds DOM focus while rows are navigated. */
	shellRef: React.RefObject<HTMLElement | null>;
	/** Attach to the focused row so navigating past the fold scrolls it in. */
	focusedRowRef: React.RefObject<HTMLLIElement | null>;
}

/**
 * Creates the dialog controller for a questionnaire.
 * @param questions - Questions the agent asked, in order.
 * @param onFinish - Called once with the collected answers when the user submits
 *   or dismisses the dialog.
 * @returns The dialog state plus its action, keyboard, and focus handles.
 */
export function useQuestionnaire({
	questions,
	onFinish,
}: {
	questions: readonly AskUserQuestionItem[];
	onFinish: (input: {
		answers: readonly AskUserQuestionAnswer[];
		cancelled: boolean;
	}) => void;
}): Questionnaire {
	const [state, setState] = useState(() => createQuestionnaireState(questions));
	const inputRef = useRef<HTMLInputElement>(null);
	const shellRef = useRef<HTMLElement>(null);
	const focusedRowRef = useRef<HTMLLIElement>(null);
	const finishRef = useRef(onFinish);
	const stateRef = useRef(state);
	// Sync in an effect, not during render: render must stay pure so React can
	// replay it. `run`/`handleKeyDown` stay stable and read the latest via refs.
	useEffect(() => {
		finishRef.current = onFinish;
		stateRef.current = state;
	});

	const run = useCallback((action: QuestionnaireAction) => {
		const { outcome, state: next } = applyQuestionnaireAction(
			stateRef.current,
			action,
		);
		stateRef.current = next;
		setState(next);
		if (outcome !== 'open') {
			finishRef.current({
				answers: collectAnswers(next),
				cancelled: outcome === 'cancelled',
			});
		}
	}, []);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			if (activatesFocusedButton(event)) {
				return;
			}
			const action = routeQuestionnaireKey(event, stateRef.current);
			if (!action) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			run(action);
		},
		[run],
	);

	// Row focus is virtual, so DOM focus has to be pulled back to the shell after
	// every move. Left on a row's button, a later Enter would activate that stale
	// button instead of the row the user can see is focused. Nothing native
	// scrolls a virtual move either, so the capped row list is walked by hand.
	const focusTarget = state.typing
		? 'free-text'
		: `row-${state.pageIndex}-${state.focusIndex}`;
	useEffect(() => {
		focusedRowRef.current?.scrollIntoView({ block: 'nearest' });
		if (focusTarget === 'free-text') {
			inputRef.current?.focus();
			return;
		}
		shellRef.current?.focus();
	}, [focusTarget]);

	return { focusedRowRef, handleKeyDown, inputRef, run, shellRef, state };
}
