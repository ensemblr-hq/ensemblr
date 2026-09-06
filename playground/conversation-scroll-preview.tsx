import { useEffect, useState } from 'react';
import { ChatMessageText } from '@/renderer/components/chat-message-text';
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
const STREAM_TICK_MS = 80;
const STREAM_FENCE_LINES = 40;
const PANE_LINES = 20;

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
			<StreamingScrollCase />
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

/**
 * A turn that is still streaming, so the transcript grows under a viewport the
 * user has scrolled away from. The body arrives as partial markdown with an
 * unclosed fence, so Streamdown re-tokenizes and re-lays-out the block on every
 * tick — the resize shape that used to drag the viewport out from under the
 * reader. Scroll up, start the stream, and the view should not move.
 */
function StreamingScrollCase() {
	const [ticks, setTicks] = useState(0);
	const [streaming, setStreaming] = useState(false);

	useEffect(() => {
		if (!streaming) {
			return;
		}
		const timer = setInterval(
			() => setTicks((previous) => previous + 1),
			STREAM_TICK_MS,
		);
		return () => clearInterval(timer);
	}, [streaming]);

	const toggleStreaming = () => setStreaming((previous) => !previous);
	const reset = () => setTicks(0);

	return (
		<section className='flex flex-col gap-2'>
			<h2 className='font-mono text-muted-foreground text-xs'>
				streaming while scrolled up
			</h2>
			<div className='flex gap-2'>
				<button
					className='rounded-md border border-border px-2 py-1 font-mono text-xs'
					data-testid='streaming-toggle'
					onClick={toggleStreaming}
					type='button'
				>
					{streaming ? 'stop stream' : 'start stream'}
				</button>
				<button
					className='rounded-md border border-border px-2 py-1 font-mono text-xs'
					data-testid='streaming-reset'
					onClick={reset}
					type='button'
				>
					reset
				</button>
			</div>
			<div
				className='h-160 overflow-hidden rounded-md border border-border'
				data-testid='streaming-transcript'
			>
				<Conversation className='size-full'>
					<ConversationContent
						className='gap-6 px-4 py-5'
						scrollKey='playground-streaming'
					>
						{Array.from({ length: LONG_TRANSCRIPT_TURNS }, (_, index) => (
							<ConversationScrollTurn index={index} key={index} />
						))}
						<StreamingAnswer ticks={ticks} />
					</ConversationContent>
					<ConversationScrollButton />
				</Conversation>
			</div>
		</section>
	);
}

/**
 * The growing body of the streaming turn, run through the same Streamdown
 * renderer the real timeline uses so fenced blocks are tokenized — and briefly
 * left unclosed — exactly as they are mid-stream.
 */
function StreamingAnswer({ ticks }: { ticks: number }) {
	return (
		<div className='flex flex-col gap-3' data-testid='streaming-answer'>
			<p className='text-sm'>Turn {LONG_TRANSCRIPT_TURNS + 1}: stream me.</p>
			<UncontainedPane />
			<ChatMessageText text={streamedMarkdown(ticks)} />
		</div>
	);
}

/**
 * A pane that scrolls in its own right but does not contain the chain, the shape
 * a wide answer table has. Wheeling up inside it while it still has room must
 * leave the stream followed; wheeling up once it is at its own top scrolls the
 * transcript instead, and has to release the lock along with it.
 */
function UncontainedPane() {
	return (
		<div
			className='max-h-24 overflow-y-auto rounded-md border border-border p-2'
			data-testid='uncontained-pane'
		>
			<pre className='m-0 whitespace-pre-wrap p-0 font-mono text-xs'>
				{Array.from(
					{ length: PANE_LINES },
					(_, line) => `row ${line + 1} of a table that chains`,
				).join('\n')}
			</pre>
		</div>
	);
}

/**
 * The markdown an assistant has emitted by a given tick: prose, then a fenced
 * block that grows a line at a time and only closes once it is finished.
 * @param ticks - Number of stream ticks elapsed
 * @returns The partial markdown to render at that tick.
 */
function streamedMarkdown(ticks: number): string {
	const fenceLines = Math.min(ticks, STREAM_FENCE_LINES);
	const body = Array.from(
		{ length: fenceLines },
		(_, line) => `const step${line + 1} = resolve(${line + 1});`,
	).join('\n');
	const closed = ticks > STREAM_FENCE_LINES ? '\n```' : '';
	const tail =
		ticks > STREAM_FENCE_LINES
			? `\n\nThat is the whole sequence, repeated ${ticks - STREAM_FENCE_LINES} times.`
			: '';
	return `Here is what that command does, step by step.\n\n\`\`\`ts\n${body}${closed}${tail}`;
}
