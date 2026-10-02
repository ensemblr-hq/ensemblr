import Ansi from 'ansi-to-react';
import { TextSurface } from '@/renderer/components/code-surface';

/**
 * A command's output, on the app's shared text surface with the ANSI colours
 * the command emitted still in place.
 *
 * There is no title bar and no framed window: the row above already says which
 * tool ran and what it ran, so a second "Terminal" heading inside the row named
 * the surface twice and broke the rhythm every other tool body keeps. What the
 * heading carried that was worth keeping — copying the output — is the same
 * hover control every code surface offers.
 *
 * Opens on the last line rather than the first: a command that failed says so
 * at the bottom, and a long build log would otherwise open on its banner.
 */
export function TerminalOutput({
	isStreaming = false,
	text,
}: {
	/** Draws a blinking cursor after the output while the command is still running. */
	isStreaming?: boolean;
	text: string;
}) {
	return (
		<TextSurface copyText={text} startAtEnd>
			<pre className='wrap-break-word m-0 whitespace-pre-wrap p-0'>
				<Ansi>{text}</Ansi>
				{isStreaming ? (
					<span className='ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-code-foreground align-text-bottom' />
				) : null}
			</pre>
		</TextSurface>
	);
}
