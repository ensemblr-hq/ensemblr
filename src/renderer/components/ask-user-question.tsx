/**
 * The agent question dialog. A Pi agent that calls `ask_user_question` is
 * blocked until this resolves, so it takes the composer's place in the chat that
 * asked: pick a numbered option, type your own answer, or dismiss it.
 */
import { XIcon } from 'lucide-react';
import { QuestionFooter } from '@/renderer/components/ask-user-question/question-footer';
import { QuestionRows } from '@/renderer/components/ask-user-question/question-rows';
import { Button } from '@/renderer/components/ui/button';
import { useQuestionnaire } from '@/renderer/hooks/ask-user-question/use-questionnaire';
import type {
	AskUserQuestionAnswer,
	AskUserQuestionItem,
} from '@/shared/agent-control';

/**
 * Renders the questionnaire an agent is waiting on.
 *
 * Keyboard: number keys pick an option (`0` jumps to the free-text row), arrows
 * move between rows and questions, Enter confirms, ⌘/Ctrl+Enter submits
 * everything answered so far, and Escape dismisses.
 */
export function AskUserQuestionCard({
	onFinish,
	questions,
}: {
	onFinish: (input: {
		answers: readonly AskUserQuestionAnswer[];
		cancelled: boolean;
	}) => void;
	questions: readonly AskUserQuestionItem[];
}) {
	const { handleKeyDown, inputRef, run, shellRef, state } = useQuestionnaire({
		onFinish,
		questions,
	});
	const question = state.questions[state.pageIndex];

	if (!question) {
		return null;
	}

	return (
		<footer className='shrink-0 bg-background px-4 pt-2 pb-5'>
			<section
				aria-label='Agent question'
				className='mx-auto flex w-full max-w-4xl flex-col gap-2 rounded-xl border border-border bg-pane/80 px-4 pt-3 pb-2.5 shadow-panel outline-none'
				onKeyDown={handleKeyDown}
				ref={shellRef}
				tabIndex={-1}
			>
				<header className='flex items-start justify-between gap-3'>
					<h2 className='min-w-0 flex-1 text-pretty font-medium text-foreground text-sm leading-5'>
						{question.question}
					</h2>
					<Button
						aria-label='Dismiss question'
						className='-mt-0.5 -mr-1'
						onClick={() => run({ type: 'cancel' })}
						size='icon-xs'
						type='button'
						variant='subtle'
					>
						<XIcon aria-hidden='true' />
					</Button>
				</header>

				<QuestionRows
					inputRef={inputRef}
					onKeyDown={handleKeyDown}
					run={run}
					state={state}
				/>

				<QuestionFooter run={run} state={state} />
			</section>
		</footer>
	);
}
