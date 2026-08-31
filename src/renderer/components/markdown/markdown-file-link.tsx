import type { ReactNode } from 'react';

import { useFilePreviewOpener } from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { useMarkdownFileReference } from '@/renderer/hooks/markdown/use-markdown-file-reference';
import { FILE_REFERENCE_HREF_ATTRIBUTE } from '@/renderer/lib/markdown-rehype-plugins';

/** The props the rehype rewrite leaves on the element, as React receives them. */
interface MarkdownFileLinkProps {
	[FILE_REFERENCE_HREF_ATTRIBUTE]?: string;
	children?: ReactNode;
	title?: string;
}

/**
 * A link a markdown document wrote to another file, rendered as a link that
 * opens that file's tab rather than as one the app would try to navigate to.
 *
 * Reached through the `ensemblr-file-link` element the rehype chain rewrites a
 * path-destined anchor into, so ordinary http links never pass through here and
 * keep Streamdown's own link-safety affordances. What the author wrote as the
 * link text is what it still reads as: a document says "see the
 * [Requirements](./02-requirements.md)", and turning that into a chip bearing a
 * filename would take the sentence apart.
 *
 * It is a button rather than an anchor because there is nothing to navigate to —
 * a relative href resolves against the app bundle, and following one would
 * replace the window. Streamdown draws its own links as buttons for the same
 * reason, so `data-streamdown="link"` is what makes this read as one.
 *
 * A destination the workspace cannot place — a link into a repository the
 * document was written for rather than this one, a file since deleted — falls
 * back to the link text as prose, so nothing looks openable that would open onto
 * an error.
 *
 * A destination outside the workspace still opens, unlike the images beside it:
 * following a link is the reader's own decision, and agents write `~/.claude/`
 * and `/tmp` paths constantly.
 */
export function MarkdownFileLink({
	children,
	title,
	...props
}: MarkdownFileLinkProps) {
	const openFilePreview = useFilePreviewOpener();
	const reference = useMarkdownFileReference(
		props[FILE_REFERENCE_HREF_ATTRIBUTE] ?? '',
	);
	const match = reference.kind === 'local' ? reference.match : null;

	if (!(openFilePreview && match)) {
		return <>{children}</>;
	}
	return (
		<button
			data-streamdown='link'
			onClick={() => openFilePreview(match.path)}
			title={title ?? match.path}
			type='button'
		>
			{children}
		</button>
	);
}
