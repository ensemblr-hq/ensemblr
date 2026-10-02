/**
 * Renderer types for the agent question dialog — the state model the pure
 * questionnaire helpers in `lib/ask-user-question/` operate on, plus the pending
 * request the dialog is rendered from.
 */
import type {
	AskUserQuestionAnswer,
	AskUserQuestionItem,
} from '@/shared/agent-control';

/** A row the user can focus: one of the question's options, or the free-text row. */
export interface QuestionnaireRow {
	kind: 'option' | 'freeText';
	/** Display number: 1-based for options, 0 for the free-text row. */
	number: number;
	label: string;
	description: string | null;
}

/** Everything the dialog needs to render and drive one questionnaire. */
export interface QuestionnaireState {
	questions: readonly AskUserQuestionItem[];
	/** Question currently on screen. */
	pageIndex: number;
	/** Focused row within the current question. */
	focusIndex: number;
	/** Whether the free-text row has the caret. */
	typing: boolean;
	/** Free-text drafts, keyed by question index. */
	drafts: Readonly<Record<number, string>>;
	/** Checked option labels for multi-select questions, keyed by question index. */
	checked: Readonly<Record<number, readonly string[]>>;
	/** Recorded answers, keyed by question index. */
	answers: Readonly<Record<number, AskUserQuestionAnswer>>;
}

/** Every way the dialog can be driven, from a key press or a pointer. */
export type QuestionnaireAction =
	| { type: 'focusRow'; index: number }
	| { type: 'moveFocus'; delta: number }
	| { type: 'choose'; index: number }
	| { type: 'confirm' }
	| { type: 'draft'; value: string }
	| { type: 'goToPage'; index: number }
	| { type: 'movePage'; delta: number }
	| { type: 'submit' }
	| { type: 'cancel' };

/** How an action left the dialog: still open, or finished one of two ways. */
export type QuestionnaireOutcome = 'open' | 'submitted' | 'cancelled';

/** An action's effect: the next state plus whether the dialog is now done. */
export interface QuestionnaireTransition {
	state: QuestionnaireState;
	outcome: QuestionnaireOutcome;
}

/** The subset of a keyboard event the key router needs, so tests need no DOM. */
export interface QuestionnaireKey {
	key: string;
	metaKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
}
