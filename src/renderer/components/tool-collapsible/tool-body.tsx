import { CodePanel } from '@/renderer/components/code-surface';
import { MessageResponse } from '@/renderer/components/message';
import { StackTraceDiagnostic } from '@/renderer/components/stack-trace-diagnostic';
import { Terminal } from '@/renderer/components/terminal';
import { cn } from '@/renderer/lib/utils';
import type { ToolBodyDescriptor } from '@/renderer/types/tool-presentation';
import { ToolDiagnosticsList } from './tool-diagnostics-list';
import { ToolDiffPreview } from './tool-diff-preview';
import { ToolErrorOutput, ToolLabeledPanel } from './tool-panel';

/**
 * Body for a reasoning row. Renders markdown through the app's real
 * `MessageResponse`, so fenced code, lists, and inline-code chips behave
 * exactly as they do in a normal assistant message.
 *
 * Everything is held to `text-muted-foreground` so reasoning reads as
 * commentary rather than as an answer. The colours are set per prose element
 * rather than with a blanket selector, which would flatten Shiki's token
 * colours inside a fenced block.
 */
function ToolMarkdownOutput({ children }: { children: string }) {
	return (
		<MessageResponse
			className={cn(
				'prose prose-sm dark:prose-invert max-w-none',
				'prose-headings:text-muted-foreground prose-p:text-muted-foreground',
				'prose-em:text-muted-foreground prose-strong:text-muted-foreground',
				'prose-blockquote:text-muted-foreground prose-code:text-muted-foreground',
				'prose-ol:text-muted-foreground prose-ul:text-muted-foreground',
				'prose-a:text-muted-foreground prose-li:text-muted-foreground',
				'prose-td:text-muted-foreground prose-th:text-muted-foreground',
				'prose-hr:border-muted',
			)}
		>
			{children}
		</MessageResponse>
	);
}

/** Placeholder shown while a tool call is still running and has no result yet. */
function ToolPendingOutput() {
	return <p className='px-1 text-muted-foreground text-xs italic'>Running…</p>;
}

/**
 * Renders the body a presentation asked for. This is the one place a body kind
 * turns into a component, so adding a tool means picking a kind rather than
 * touching the row.
 */
export function ToolBody({ body }: { body: ToolBodyDescriptor }) {
	switch (body.kind) {
		case 'code':
			return (
				<CodePanel
					code={body.code}
					language={body.language}
					startLine={body.startLine}
				/>
			);
		case 'diagnostics':
			return <ToolDiagnosticsList entries={body.entries} />;
		case 'diff':
			return <ToolDiffPreview language={body.language} patch={body.patch} />;
		case 'empty':
			return null;
		case 'error':
			return <ToolErrorOutput>{body.text}</ToolErrorOutput>;
		case 'labeled':
			return <ToolLabeledPanel sections={body.sections} />;
		case 'markdown':
			return <ToolMarkdownOutput>{body.text}</ToolMarkdownOutput>;
		case 'pending':
			return <ToolPendingOutput />;
		case 'stack-trace':
			return (
				<StackTraceDiagnostic
					className='border-destructive/20'
					trace={body.trace}
				/>
			);
		case 'terminal':
			return <Terminal isStreaming={false} output={body.text} />;
		default: {
			const exhaustive: never = body;
			void exhaustive;
			return null;
		}
	}
}
