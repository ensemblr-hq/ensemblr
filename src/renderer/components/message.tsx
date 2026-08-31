'use client';

import { cjk } from '@streamdown/cjk';
import { createCodePlugin } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import { useAtomValue } from 'jotai';
import type { ComponentProps, ReactNode } from 'react';
import { Children, memo, useMemo } from 'react';
import { Streamdown } from 'streamdown';
import { ConciergeReferenceChip } from '@/renderer/components/concierge/concierge-reference-chip';
import {
	MarkdownFileLink,
	MarkdownImage,
	useMarkdownDocumentScope,
} from '@/renderer/components/markdown';
import {
	attachmentPathFromInlineCode,
	chipLabelForPath,
	isOutsideWorkspacePath,
} from '@/renderer/lib/agent-timeline';
import { toBundledLanguage } from '@/renderer/lib/language-from-path';
import { documentReferenceLookupPath } from '@/renderer/lib/markdown-references';
import {
	CONCIERGE_REFERENCE_ELEMENT,
	FILE_IMAGE_ELEMENT,
	FILE_REFERENCE_ELEMENT,
	MARKDOWN_REHYPE_PLUGINS,
} from '@/renderer/lib/markdown-rehype-plugins';
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
				[CONCIERGE_REFERENCE_ELEMENT]: ConciergeReferenceChip,
				[FILE_IMAGE_ELEMENT]: MarkdownImage,
				[FILE_REFERENCE_ELEMENT]: MarkdownFileLink,
				img: MarkdownImage,
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
	const documentScope = useMarkdownDocumentScope();
	const inlineText = textFromCodeChildren(children);
	const attachmentPath = attachmentPathFromInlineCode(inlineText);
	const resolvedPath = attachmentPath
		? placeInlinePath({
				attachmentPath,
				baseDirectory: documentScope?.baseDirectory ?? '',
				resolveWorkspacePath,
			})
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
 *
 * A document previewed from the workspace is tried against its own directory
 * first, because that is what a path in a markdown file means, and only then
 * against the workspace root, which is how an agent writes one in chat. The two
 * readings cannot be told apart from the text alone, so both are asked and the
 * tree decides.
 * @param params - The path as it appeared in the prose, the directory of the
 *   document that wrote it (empty in chat), and the resolver from context.
 * @returns The entry to bind the chip to, or null when the tree lacks the path.
 */
function placeInlinePath({
	attachmentPath,
	baseDirectory,
	resolveWorkspacePath,
}: {
	attachmentPath: string;
	baseDirectory: string;
	resolveWorkspacePath: WorkspacePathResolver | null;
}): WorkspacePathMatch | null {
	if (!resolveWorkspacePath) {
		return {
			kind: 'file',
			path: attachmentPath,
			scope: isOutsideWorkspacePath(attachmentPath) ? 'external' : 'workspace',
		};
	}
	if (!baseDirectory) {
		return resolveWorkspacePath(attachmentPath);
	}
	const anchored = documentReferenceLookupPath(attachmentPath, baseDirectory);
	return (
		(anchored ? resolveWorkspacePath(anchored) : null) ??
		resolveWorkspacePath(attachmentPath)
	);
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
