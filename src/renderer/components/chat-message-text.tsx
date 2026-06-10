import type { BundledLanguage } from 'shiki';
import { classifyToolOutput, looksLikeStructuredDump } from '@/renderer/lib/pi';
import { cn } from '@/renderer/lib/utils';

import { CodeBlock } from './code-block';
import { MessageResponse } from './message';
import { Terminal } from './terminal';

const MIN_FENCED_LINES = 3;

interface Segment {
	body: string;
	kind: 'prose' | 'terminal' | 'code' | 'json' | 'path-tree' | 'stack-trace';
	language?: BundledLanguage;
}

/**
 * Renders assistant text with per-paragraph classification. Each blank-line-
 * delimited block runs through {@link classifyToolOutput} and is wrapped in the
 * matching primitive (Terminal for shell output, CodeBlock for code/JSON/path
 * trees, StackTrace-style block isn't applied here because errors come from a
 * different envelope kind). Short or markdown-looking blocks fall through to
 * Streamdown so fenced/code-inline content from Pi still renders correctly.
 */
export function ChatMessageText({
	className,
	text,
}: {
	className?: string;
	text: string;
}) {
	const segments = segmentForClassification(text);
	if (segments.length === 0) {
		return null;
	}
	if (segments.length === 1 && segments[0]?.kind === 'prose') {
		return (
			<MessageResponse className={className}>
				{segments[0].body}
			</MessageResponse>
		);
	}
	return (
		<div className={cn('flex flex-col gap-3', className)}>
			{segments.map((segment, index) => (
				<SegmentRenderer key={`${segment.kind}:${index}`} segment={segment} />
			))}
		</div>
	);
}

function SegmentRenderer({ segment }: { segment: Segment }) {
	switch (segment.kind) {
		case 'terminal':
			return <Terminal isStreaming={false} output={segment.body} />;
		case 'code':
			return (
				<CodeBlock
					code={segment.body}
					language={segment.language ?? ('typescript' as BundledLanguage)}
				/>
			);
		case 'json':
			return <CodeBlock code={segment.body} language='json' />;
		case 'path-tree':
		case 'stack-trace':
			return (
				<CodeBlock code={segment.body} language={'text' as BundledLanguage} />
			);
		default:
			return <MessageResponse>{segment.body}</MessageResponse>;
	}
}

/**
 * Splits text on blank lines (paragraph boundary). For each paragraph runs the
 * shared tool-output classifier. Paragraphs with fewer than {@link MIN_FENCED_LINES}
 * lines stay prose so we do not re-format short snippets the user is reading
 * inline. Adjacent same-kind segments are merged so a long shell transcript
 * stays in one Terminal box rather than fracturing.
 */
function segmentForClassification(text: string): Segment[] {
	const paragraphs = text.split(/\n{2,}/);
	const segments: Segment[] = [];
	for (const paragraph of paragraphs) {
		const trimmed = paragraph.trim();
		if (trimmed.length === 0) {
			continue;
		}
		// Strong signals override the line-count guard: ls dumps and session-
		// state key/value runs arrive as one logical line that soft-wraps into
		// soup if it reaches the markdown renderer.
		if (hasStrongDataSignal(trimmed)) {
			const classification = classifyToolOutput('text', trimmed);
			append(segments, {
				body: classification.text,
				kind: classification.kind === 'text' ? 'code' : classification.kind,
				language: classification.language,
			});
			continue;
		}
		const lineCount = trimmed.split('\n').length;
		if (lineCount < MIN_FENCED_LINES || isMarkdownLike(trimmed)) {
			append(segments, { body: trimmed, kind: 'prose' });
			continue;
		}
		const classification = classifyToolOutput('text', trimmed);
		switch (classification.kind) {
			case 'terminal':
				append(segments, { body: classification.text, kind: 'terminal' });
				break;
			case 'code':
				append(segments, {
					body: classification.text,
					kind: 'code',
					language: classification.language,
				});
				break;
			case 'json':
				append(segments, { body: classification.text, kind: 'json' });
				break;
			case 'path-tree':
				append(segments, { body: classification.text, kind: 'path-tree' });
				break;
			case 'stack-trace':
				append(segments, { body: classification.text, kind: 'stack-trace' });
				break;
			default:
				append(segments, { body: trimmed, kind: 'prose' });
				break;
		}
	}
	return segments;
}

function append(segments: Segment[], segment: Segment): void {
	const last = segments[segments.length - 1];
	if (last && last.kind === segment.kind) {
		last.body = `${last.body}\n\n${segment.body}`;
		return;
	}
	segments.push(segment);
}

const MARKDOWN_SIGNALS = [
	/^#{1,6}\s/m,
	/^\s*[-*]\s/m,
	/^\s*\d+\.\s/m,
	/^>\s/m,
	/```/m,
	/\[[^\]]+\]\([^)]+\)/,
	/^\|.+\|/m,
];

function isMarkdownLike(text: string): boolean {
	return MARKDOWN_SIGNALS.some((pattern) => pattern.test(text));
}

const LS_OUTPUT_SIGNAL = /(^|\s)[bcdlps-][rwxsStT-]{8,9}[@+]?\s+\d+\s+\S+/;

function hasStrongDataSignal(text: string): boolean {
	return LS_OUTPUT_SIGNAL.test(text) || looksLikeStructuredDump(text);
}
