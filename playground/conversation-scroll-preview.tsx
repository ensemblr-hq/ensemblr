import { ChatTurnSummary } from '@/renderer/components/chat-turn-summary';
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from '@/renderer/components/conversation';
import { ToolCollapsible } from '@/renderer/components/tool-collapsible';
import { ToolPanel } from '@/renderer/components/tool-collapsible/tool-panel';

const SHORT_TRANSCRIPT_TURNS = 3;
const LONG_TRANSCRIPT_TURNS = 14;
const SUMMARY_FOLDED_ROWS = 22;
const BODY_LINES = 24;

/**
 * Scroll behaviour of the real conversation surface, in the two shapes that
 * behave differently: a transcript that does not fill its tab, where opening a
 * row makes the viewport scrollable for the first time, and one that already
 * scrolls. In both, the heading of the row being opened should stay exactly
 * where the user clicked it instead of the view jumping to the newest message.
 */
export function ConversationScrollScene() {
	return (
		<div className='flex flex-col gap-6'>
			<ConversationScrollCase
				label='transcript shorter than the tab'
				testId='short-transcript'
				turns={SHORT_TRANSCRIPT_TURNS}
			/>
			<ConversationScrollCase
				label='transcript already scrolling'
				testId='long-transcript'
				turns={LONG_TRANSCRIPT_TURNS}
			/>
			<TurnSummaryScrollCase />
		</div>
	);
}

/**
 * A settled turn folded behind its summary chip — the row that unfolds a whole
 * turn's worth of activity at once, and the biggest jump the lock used to make.
 */
function TurnSummaryScrollCase() {
	return (
		<section className='flex flex-col gap-2'>
			<h2 className='font-mono text-muted-foreground text-xs'>
				settled turn behind its summary chip
			</h2>
			<div
				className='h-160 overflow-hidden rounded-md border border-border'
				data-testid='summary-transcript'
			>
				<Conversation className='size-full'>
					<ConversationContent className='gap-6 px-4 py-5'>
						<p className='text-sm'>Turn 1: go and do the whole thing.</p>
						<ChatTurnSummary
							durationMs={92_000}
							messageCount={4}
							toolGlyphs={Array.from(
								{ length: SUMMARY_FOLDED_ROWS },
								() => 'terminal' as const,
							)}
						>
							{Array.from({ length: SUMMARY_FOLDED_ROWS }, (_, index) => (
								<ConversationScrollTurn index={index} key={index} />
							))}
						</ChatTurnSummary>
					</ConversationContent>
					<ConversationScrollButton />
				</Conversation>
			</div>
		</section>
	);
}

/** One labelled conversation viewport holding `turns` openable tool rows. */
function ConversationScrollCase({
	label,
	testId,
	turns,
}: {
	label: string;
	testId: string;
	turns: number;
}) {
	return (
		<section className='flex flex-col gap-2'>
			<h2 className='font-mono text-muted-foreground text-xs'>{label}</h2>
			<div
				className='h-160 overflow-hidden rounded-md border border-border'
				data-testid={testId}
			>
				<Conversation className='size-full'>
					<ConversationContent className='gap-6 px-4 py-5'>
						{Array.from({ length: turns }, (_, index) => (
							<ConversationScrollTurn index={index} key={index} />
						))}
					</ConversationContent>
					<ConversationScrollButton />
				</Conversation>
			</div>
		</section>
	);
}

/** One prompt and the openable tool row that answered it. */
function ConversationScrollTurn({ index }: { index: number }) {
	return (
		<div className='flex flex-col gap-3'>
			<p className='text-sm'>Turn {index + 1}: what did that command print?</p>
			<ToolCollapsible
				glyph='terminal'
				title={`Ran a command (turn ${index + 1})`}
			>
				<ToolPanel>
					<pre className='m-0 whitespace-pre-wrap p-0 font-mono text-xs'>
						{Array.from(
							{ length: BODY_LINES },
							(_, line) => `line ${line + 1} of the tool output`,
						).join('\n')}
					</pre>
				</ToolPanel>
			</ToolCollapsible>
		</div>
	);
}
