/**
 * Footer of the agent question dialog: the question pager, the key hints for
 * the question on screen, and the submit button.
 */
import { ArrowUpIcon } from 'lucide-react';

import { QuestionPager } from '@/renderer/components/ask-user-question/question-pager';
import { Button } from '@/renderer/components/ui/button';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { headerOf, isAnswered } from '@/renderer/lib/ask-user-question';
import type {
	QuestionnaireAction,
	QuestionnaireState,
} from '@/renderer/types/ask-user-question';
import type { AskUserQuestionItem } from '@/shared/agent-control';
import { formatShortcut } from '@/shared/keymap';

/** Platform label for the chord that submits every answer recorded so far. */
const SUBMIT_SHORTCUT = formatShortcut('question.submit');

/**
 * Builds the footer key hints. The submit chord only earns its place when Enter
 * alone cannot finish — a multi-select question never advances on Enter, and a
 * multi-question run may be worth answering only in part.
 * @param question - Question currently on screen.
 * @param questionCount - How many questions the agent asked.
 * @returns The hint line for this question.
 */
function keyHints(
	question: AskUserQuestionItem,
	questionCount: number,
): string {
	const confirm = question.multiSelect ? 'Enter toggle' : 'Enter select';
	const needsChord = questionCount > 1 || question.multiSelect === true;
	return [
		'↑↓ move',
		confirm,
		...(needsChord ? [`${SUBMIT_SHORTCUT} submit`] : []),
		'Esc dismiss',
	].join(' · ');
}

/** Renders the pager, key hints, and submit control for the dialog. */
export function QuestionFooter({
	run,
	state,
}: {
	run: (action: QuestionnaireAction) => void;
	state: QuestionnaireState;
}) {
	const question = state.questions[state.pageIndex];
	if (!question) {
		return null;
	}
	const pages = state.questions.map((item, index) => ({
		answered: isAnswered(state, index),
		key: item.question,
		label: headerOf(item, index),
	}));
	return (
		<div className='flex items-center justify-between gap-3'>
			<div className='-ml-1 flex min-w-0 items-center gap-2'>
				<QuestionPager
					activeIndex={state.pageIndex}
					onGoToPage={(index) => run({ index, type: 'goToPage' })}
					onMovePage={(delta) => run({ delta, type: 'movePage' })}
					pages={pages}
				/>
				<p className='truncate pl-1 text-muted-foreground/60 text-xs'>
					{keyHints(question, state.questions.length)}
				</p>
			</div>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						aria-label='Submit answers'
						className='rounded-md'
						onClick={() => run({ type: 'submit' })}
						size='icon-sm'
						type='button'
					>
						<ArrowUpIcon aria-hidden='true' />
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					Submit answers
					<span className='ml-2 text-muted-foreground'>{SUBMIT_SHORTCUT}</span>
				</TooltipContent>
			</Tooltip>
		</div>
	);
}
