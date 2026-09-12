import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TextSurface } from '@/renderer/components/code-surface';
import { parseStackTrace } from '@/renderer/lib/agent-timeline';
import { withListKeys } from '@/renderer/lib/list-keys';
import type { StackFrame } from '@/renderer/types/agent-timeline';

/**
 * A traceback on the app's shared text surface: the error line, then the frames
 * that are the app's own, with runtime and dependency frames left out.
 *
 * Shared by the two surfaces that show one — a runtime diagnostic in the
 * timeline and a failed tool call's body — so the two cannot drift apart. Both
 * already own a disclosure and a heading, so this renders the trace flat and
 * lets the caller fold it rather than nesting a second one.
 */
export function StackTraceDiagnostic({ trace }: { trace: string }) {
	const { t } = useTranslation();
	const parsed = useMemo(() => parseStackTrace(trace), [trace]);
	const frames = useMemo(
		() =>
			withListKeys(
				parsed.frames.filter((frame) => !frame.isInternal),
				(frame) => frame.raw,
			),
		[parsed],
	);

	return (
		<TextSurface copyText={trace}>
			<p className='wrap-break-word m-0 pb-0.5 text-destructive'>
				{parsed.errorType ? (
					<span className='font-semibold'>{parsed.errorType}: </span>
				) : null}
				{parsed.errorMessage}
			</p>
			{frames.map(({ item, key }) => (
				<StackTraceFrame frame={item} key={key} />
			))}
			{frames.length === 0 ? (
				<p className='m-0 text-code-foreground/50'>
					{t('common:stack-trace.empty', 'No stack frames')}
				</p>
			) : null}
		</TextSurface>
	);
}

/**
 * One frame, printed the way a runtime prints it — `at name (path:line:col)` —
 * with the porcelain dimmed so the eye lands on the function and the file.
 */
function StackTraceFrame({ frame }: { frame: StackFrame }) {
	if (!(frame.filePath || frame.functionName)) {
		return <p className='wrap-break-word m-0'>{frame.raw}</p>;
	}

	return (
		<p className='wrap-break-word m-0'>
			{/* i18next-instrument-ignore -- V8 stack-frame porcelain */}
			<span className='text-code-foreground/40'>at </span>
			{frame.functionName ? <span>{frame.functionName} </span> : null}
			{frame.filePath ? (
				<span className='text-code-foreground/70'>
					{frame.functionName ? '(' : ''}
					{frame.filePath}
					{frame.lineNumber === null ? '' : `:${frame.lineNumber}`}
					{frame.columnNumber === null ? '' : `:${frame.columnNumber}`}
					{frame.functionName ? ')' : ''}
				</span>
			) : null}
		</p>
	);
}
