'use client';

import { cjk } from '@streamdown/cjk';
import { createCodePlugin } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import { useAtomValue } from 'jotai';
import { ImageOffIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Children, memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Streamdown } from 'streamdown';
import {
	attachmentPathFromInlineCode,
	chipLabelForPath,
	isOutsideWorkspacePath,
} from '@/renderer/lib/agent-timeline';
import { toBundledLanguage } from '@/renderer/lib/language-from-path';
import { MARKDOWN_REHYPE_PLUGINS } from '@/renderer/lib/markdown-rehype-plugins';
import { cn } from '@/renderer/lib/utils';
import {
	markdownStyleAtom,
	useResolvedCodeTheme,
} from '@/renderer/state/preferences';
import type {
	WorkspacePathMatch,
	WorkspacePathResolver,
} from '@/renderer/types/workbench';
import { AnswerTable } from './answer-table';
import { ChatAttachmentChip } from './chat-attachment-chip';
import { CodePanel } from './code-surface/code-panel';
import {
	useFilePreviewOpener,
	useWorkspacePathResolver,
} from './workbench-shell/conversation-panel/file-preview-context';

/** Props for {@link MessageResponse}; mirrors Streamdown's own props. */
type MessageResponseProps = ComponentProps<typeof Streamdown>;

/** Props received by Streamdown's custom inline-code renderer. */
type InlineCodeProps = ComponentProps<'code'> & { node?: unknown };

/** Props received by Streamdown's fenced code-block renderer. */
type FencedCodeProps = ComponentProps<'code'> & { node?: unknown };

/** Props received by Streamdown's image renderer. */
type MessageImageProps = ComponentProps<'img'> & { node?: unknown };

/** Renders assistant markdown through Streamdown, honoring the user's chosen code theme and markdown style. */
export const MessageResponse = memo(
	({ className, components, ...props }: MessageResponseProps) => {
		const codeTheme = useResolvedCodeTheme();
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
		// Streamdown routes fenced blocks and inline spans through one `code`
		// slot, splitting them on a `data-block` prop once `inlineCode` is set.
		// Overriding both replaces fenced blocks with the timeline's code surface
		// while leaving inline chips to the attachment renderer.
		const answerComponents = useMemo(
			() => ({
				...components,
				code: MessageCodeBlock,
				img: MessageImage,
				inlineCode: MessageInlineCode,
				table: AnswerTable,
			}),
			[components],
		);
		// Streamdown drops props it does not recognize, so the density mode has to
		// travel on the class list rather than as a data attribute.
		return (
			<Streamdown
				className={cn(
					'ensemblr-answer size-full',
					markdownStyle !== 'default' && `ensemblr-answer-${markdownStyle}`,
					className,
				)}
				components={answerComponents}
				plugins={plugins}
				rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
				{...props}
			/>
		);
	},
	(prevProps, nextProps) =>
		prevProps.children === nextProps.children &&
		nextProps.isAnimating === prevProps.isAnimating,
);

MessageResponse.displayName = 'MessageResponse';

const FENCE_LANGUAGE = /language-([^\s]+)/;

/**
 * Renders a fenced code block in an assistant answer on the same code surface
 * the timeline's tool rows use, with a copy control revealed on hover.
 *
 * Streamdown hands the fence tag over as a `language-*` class and the body as
 * children, so both are read back off the props rather than passed directly.
 */
function MessageCodeBlock({ children, className }: FencedCodeProps) {
	const tag = className?.match(FENCE_LANGUAGE)?.at(1) ?? '';
	return (
		<CodePanel
			code={textFromCodeChildren(children).replace(/\n$/, '')}
			copyable
			language={toBundledLanguage(tag)}
		/>
	);
}

/**
 * Renders a markdown image as a plain image, inline with the text around it.
 *
 * Streamdown frames every image in a block media widget — a 1rem block margin
 * plus a hover overlay and download button — which suits a generated picture but
 * not the badges bots write. A PR comment's status dot and project favicon sit on
 * the line with the link beside them, and that margin drops the link onto a line
 * of its own. An image that stands alone still reads as a figure; Streamdown
 * unwraps its paragraph, so the stylesheet blocks it out from the answer root.
 *
 * A PR comment is third-party markdown and its images are fetched from whatever
 * host wrote them, so an image is a read receipt for whoever hosts it. Deferring
 * the fetch until the image scrolls into view keeps a thread nobody opened from
 * announcing itself, and dropping the referrer keeps the request from carrying
 * where in the app it came from.
 *
 * A host that refuses the fetch is the ordinary case rather than the exception —
 * an expired link, a private asset, an offline machine — and the platform's
 * answer to it is a broken-image glyph that reads as a rendering fault in the
 * app. A failed load falls back to a placeholder carrying the alt text instead,
 * which is the description the author wrote for exactly this.
 */
function MessageImage({ className, node: _node, ...props }: MessageImageProps) {
	const { t } = useTranslation();
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	if (!props.src) {
		return null;
	}
	if (failedSrc === props.src) {
		return (
			<span
				className={cn(
					'inline-flex max-w-full items-center gap-1.5 rounded-md border border-border border-dashed bg-muted/40 px-2 py-1 align-middle text-muted-foreground text-xs',
					className,
				)}
				data-streamdown='image-unavailable'
			>
				<ImageOffIcon aria-hidden='true' className='size-3.5 shrink-0' />
				<span className='truncate'>
					{props.alt
						? t(
								'common:message-image.unavailable-alt',
								'{{description}} (image unavailable)',
								{ description: props.alt },
							)
						: t('common:message-image.unavailable', 'Image unavailable')}
				</span>
			</span>
		);
	}
	return (
		<img
			{...props}
			alt={props.alt ?? ''}
			className={cn('inline-block max-w-full align-middle', className)}
			data-streamdown='image'
			loading='lazy'
			onError={() => setFailedSrc(props.src ?? null)}
			referrerPolicy='no-referrer'
		/>
	);
}

/**
 * Renders file-like inline code as attachment chips while preserving ordinary
 * code snippets.
 *
 * A path an agent writes in prose is not guaranteed to exist — it may have been
 * deleted or moved earlier in the same turn, or printed as a trailing fragment
 * of the real path rather than the whole thing. The resolver settles both. Only
 * a path it can place in the file tree earns a chip; anything else stays plain
 * inline code, so nothing looks openable that would open onto an error.
 */
function MessageInlineCode({
	children,
	className,
	node: _node,
	...props
}: InlineCodeProps) {
	const openFilePreview = useFilePreviewOpener();
	const resolveWorkspacePath = useWorkspacePathResolver();
	const inlineText = textFromCodeChildren(children);
	const attachmentPath = attachmentPathFromInlineCode(inlineText);
	const resolvedPath = attachmentPath
		? placeInlinePath(attachmentPath, resolveWorkspacePath)
		: null;
	if (attachmentPath && resolvedPath) {
		return (
			<ChatAttachmentChip
				className='ensemblr-answer-chip'
				kind={resolvedPath.kind === 'directory' ? 'folder' : 'file'}
				label={chipLabelForPath(attachmentPath)}
				onActivate={
					openFilePreview ? () => openFilePreview(resolvedPath.path) : undefined
				}
				title={resolvedPath.path}
			/>
		);
	}
	return (
		<code className={className} {...props}>
			{children}
		</code>
	);
}

/**
 * Places a path written in prose against the workspace file tree. Outside a
 * workspace conversation there is no tree and no resolver, and the path is taken
 * at face value — a chip there has no opener to bind to anyway, so the two null
 * cases must not collapse into one.
 * @param attachmentPath - Path the agent wrote, as it appeared in the prose.
 * @param resolveWorkspacePath - Resolver from context, null outside a workspace.
 * @returns The entry to bind the chip to, or null when the tree lacks the path.
 */
function placeInlinePath(
	attachmentPath: string,
	resolveWorkspacePath: WorkspacePathResolver | null,
): WorkspacePathMatch | null {
	if (!resolveWorkspacePath) {
		return {
			kind: 'file',
			path: attachmentPath,
			scope: isOutsideWorkspacePath(attachmentPath) ? 'external' : 'workspace',
		};
	}
	return resolveWorkspacePath(attachmentPath);
}

/** Extracts plain text from Streamdown's code children, inline or fenced. */
function textFromCodeChildren(children: ReactNode): string {
	return Children.toArray(children)
		.map((child) =>
			typeof child === 'string' || typeof child === 'number'
				? String(child)
				: '',
		)
		.join('');
}
