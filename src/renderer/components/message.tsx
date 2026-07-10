'use client';

import { cjk } from '@streamdown/cjk';
import { createCodePlugin } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import { useAtomValue } from 'jotai';
import type { ComponentProps, ReactNode } from 'react';
import { Children, memo, useMemo } from 'react';
import { Streamdown } from 'streamdown';
import {
	attachmentPathFromInlineCode,
	chipLabelForPath,
} from '@/renderer/lib/pi';
import { cn } from '@/renderer/lib/utils';
import { codeThemeAtom, markdownStyleAtom } from '@/renderer/state/preferences';
import { ChatAttachmentChip } from './chat-attachment-chip';
import {
	useFilePreviewOpener,
	useWorkspacePathKindResolver,
} from './workbench-shell/conversation-panel/file-preview-context';

/** Props for {@link MessageResponse}; mirrors Streamdown's own props. */
type MessageResponseProps = ComponentProps<typeof Streamdown>;

/** Props received by Streamdown's custom inline-code renderer. */
type InlineCodeProps = ComponentProps<'code'> & { node?: unknown };

/** Renders assistant markdown through Streamdown, honoring the user's chosen code theme and markdown style. */
export const MessageResponse = memo(
	({ className, components, ...props }: MessageResponseProps) => {
		const codeTheme = useAtomValue(codeThemeAtom);
		const markdownStyle = useAtomValue(markdownStyleAtom);
		// Rebuild the code plugin when the picked theme changes so fenced blocks
		// honor Settings → Appearance → Code theme in both light and dark modes.
		const plugins = useMemo(
			() => ({
				cjk,
				code: createCodePlugin({ themes: [codeTheme, codeTheme] }),
				math,
				mermaid,
			}),
			[codeTheme],
		);
		const componentsWithAttachmentChips = useMemo(
			() => ({
				...components,
				inlineCode: MessageInlineCode,
			}),
			[components],
		);
		return (
			<Streamdown
				className={cn(
					'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
					// Streamdown defaults lists to `list-inside`, which hangs markers at
					// the container edge and wraps continuation lines under the marker.
					// Render markers outside and shift the whole list right instead so
					// wrapped lines stay aligned with their text.
					'[&_ol]:list-outside [&_ol]:pl-6 [&_ul]:list-outside [&_ul]:pl-5',
					// Streamdown's inline-code chips use bg-muted, which barely reads
					// against the chat background — lift them a shade.
					'[&_:not(pre)>code]:bg-foreground/10 [&_:not(pre)>code]:ring-1 [&_:not(pre)>code]:ring-foreground/10',
					// Compact tightens vertical rhythm; prose applies real typography
					// styling while letting Streamdown's own code chrome show through.
					markdownStyle === 'compact' &&
						'[&_li]:my-0.5 [&_ol]:my-1.5 [&_p]:my-1.5 [&_pre]:my-2 [&_ul]:my-1.5',
					markdownStyle === 'prose' &&
						'prose prose-sm dark:prose-invert prose-pre:m-0 max-w-none prose-pre:bg-transparent prose-pre:p-0 prose-code:before:content-none prose-code:after:content-none',
					className,
				)}
				components={componentsWithAttachmentChips}
				plugins={plugins}
				{...props}
			/>
		);
	},
	(prevProps, nextProps) =>
		prevProps.children === nextProps.children &&
		nextProps.isAnimating === prevProps.isAnimating,
);

MessageResponse.displayName = 'MessageResponse';

/** Renders file-like inline code as attachment chips while preserving ordinary code snippets. */
function MessageInlineCode({
	children,
	className,
	node: _node,
	...props
}: InlineCodeProps) {
	const openFilePreview = useFilePreviewOpener();
	const resolveWorkspacePathKind = useWorkspacePathKindResolver();
	const inlineText = textFromInlineCodeChildren(children);
	const attachmentPath = attachmentPathFromInlineCode(inlineText);
	if (attachmentPath) {
		const kind =
			resolveWorkspacePathKind?.(attachmentPath) === 'directory'
				? 'folder'
				: 'file';
		return (
			<ChatAttachmentChip
				className='align-baseline'
				kind={kind}
				label={chipLabelForPath(attachmentPath)}
				onActivate={
					openFilePreview ? () => openFilePreview(attachmentPath) : undefined
				}
				title={attachmentPath}
			/>
		);
	}
	return (
		<code className={className} {...props}>
			{children}
		</code>
	);
}

/** Extracts plain text from Streamdown's inline-code children. */
function textFromInlineCodeChildren(children: ReactNode): string {
	return Children.toArray(children)
		.map((child) =>
			typeof child === 'string' || typeof child === 'number'
				? String(child)
				: '',
		)
		.join('');
}
