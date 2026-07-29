import {
	StackTrace,
	StackTraceActions,
	StackTraceContent,
	StackTraceCopyButton,
	StackTraceError,
	StackTraceErrorMessage,
	StackTraceErrorType,
	StackTraceExpandButton,
	StackTraceFrames,
	StackTraceHeader,
} from '@/renderer/components/stack-trace';

/**
 * A stack trace collapsed to its error line, with the frames behind an
 * expander and framework-internal ones hidden until asked for.
 *
 * Shared by the two surfaces that show a traceback — a runtime diagnostic in
 * the timeline and a failed tool call's body — so the two cannot drift apart.
 * They differ only in the border tint their surface calls for.
 */
export function StackTraceDiagnostic({
	className,
	trace,
}: {
	className?: string;
	trace: string;
}) {
	return (
		<StackTrace className={className} defaultOpen={false} trace={trace}>
			<StackTraceHeader>
				<StackTraceError>
					<StackTraceErrorType />
					<StackTraceErrorMessage />
				</StackTraceError>
				<StackTraceActions>
					<StackTraceCopyButton />
					<StackTraceExpandButton />
				</StackTraceActions>
			</StackTraceHeader>
			<StackTraceContent>
				<StackTraceFrames showInternalFrames={false} />
			</StackTraceContent>
		</StackTrace>
	);
}
