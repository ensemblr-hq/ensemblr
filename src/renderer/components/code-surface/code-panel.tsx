import { useMemo } from 'react';
import type { BundledLanguage } from 'shiki';
import { useHighlightedCode } from '@/renderer/hooks/code-surface/use-highlighted-code';
import { cn } from '@/renderer/lib/utils';
import { CodeGutter, CodeLineTokens } from './code-lines';
import { CODE_CONTENT_CLASSES } from './code-style';
import { CodeSurface } from './code-surface';

/**
 * Syntax-highlighted code on the shared surface — the block used for tool
 * output, file reads, and fenced code in assistant answers alike.
 *
 * Chat density: smaller type than the panel-filling `CodeBlock`, on the same row
 * height, so a snippet in a conversation reads as the compact cut of the same
 * component. Pass `startLine` to number the gutter from a real file offset; omit
 * it for bare command output. `language` is a Shiki grammar; an id the bundle
 * does not carry falls back to uncoloured text rather than failing.
 */
export function CodePanel({
	code,
	copyable = false,
	language,
	startLine,
}: {
	code: string;
	/** Reveals a copy button in the top-right corner on hover. */
	copyable?: boolean;
	language: BundledLanguage;
	startLine?: number | null;
}) {
	const tokenized = useHighlightedCode(code, language);
	const textLines = useMemo(() => code.split('\n'), [code]);
	const lastLineNumber =
		startLine === undefined || startLine === null
			? null
			: startLine + textLines.length - 1;

	return (
		<CodeSurface copyText={copyable ? code : undefined}>
			{textLines.map((text, lineIndex) => (
				<div className='flex' key={`line-${lineIndex}`}>
					{lastLineNumber === null ? null : (
						<CodeGutter
							divider
							maxLineNumber={lastLineNumber}
							value={(startLine ?? 0) + lineIndex}
						/>
					)}
					<span
						className={cn(
							CODE_CONTENT_CLASSES,
							lastLineNumber === null && 'pl-3',
						)}
					>
						<CodeLineTokens
							fallback={text}
							lineKey={`line-${lineIndex}`}
							tokens={tokenized?.tokens[lineIndex] ?? null}
						/>
					</span>
				</div>
			))}
		</CodeSurface>
	);
}
