/**
 * The row list of the agent question dialog: every option of the current
 * question, then the free-text row the user can type their own answer into.
 */
import {
	QuestionFreeTextRow,
	QuestionOptionRow,
} from '@/renderer/components/ask-user-question/question-row';
import { rowsOf } from '@/renderer/lib/ask-user-question';
import type {
	QuestionnaireAction,
	QuestionnaireState,
} from '@/renderer/types/ask-user-question';

/** Renders the focusable rows of the question currently on screen. */
export function QuestionRows({
	inputRef,
	onKeyDown,
	run,
	state,
}: {
	inputRef: React.RefObject<HTMLInputElement | null>;
	onKeyDown: (event: React.KeyboardEvent) => void;
	run: (action: QuestionnaireAction) => void;
	state: QuestionnaireState;
}) {
	const question = state.questions[state.pageIndex];
	if (!question) {
		return null;
	}
	const checkedLabels = new Set(state.checked[state.pageIndex] ?? []);
	const answer = state.answers[state.pageIndex];
	return (
		<ul className='-mx-2 flex flex-col'>
			{rowsOf(question).map((row, index) =>
				row.kind === 'option' ? (
					<li key={row.label}>
						<QuestionOptionRow
							checked={
								question.multiSelect
									? checkedLabels.has(row.label)
									: answer?.answer === row.label
							}
							focused={state.focusIndex === index}
							multiSelect={question.multiSelect ?? false}
							onSelect={() => run({ index, type: 'choose' })}
							row={row}
						/>
					</li>
				) : (
					<li
						className={index > 0 ? 'mt-1 border-border/60 border-t pt-1' : ''}
						key='free-text'
					>
						<QuestionFreeTextRow
							focused={state.typing}
							inputRef={inputRef}
							onChange={(value) => run({ type: 'draft', value })}
							onFocus={() => run({ index, type: 'focusRow' })}
							onKeyDown={onKeyDown}
							row={row}
							value={state.drafts[state.pageIndex] ?? ''}
						/>
					</li>
				),
			)}
		</ul>
	);
}
