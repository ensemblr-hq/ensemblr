import type { ComponentProps } from 'react';

import { useMarkdownImageSource } from '@/renderer/hooks/markdown/use-markdown-image-source';
import {
	FILE_IMAGE_SRC_ATTRIBUTE,
	FILE_SOURCE_DESCRIPTOR_ATTRIBUTE,
} from '@/renderer/lib/markdown-rehype-plugins';

/**
 * Props received for a `<picture>` source the rehype chain moved off `srcset`,
 * because the file it names is one the workspace holds.
 */
type MarkdownPictureSourceProps = ComponentProps<'source'> & {
	[FILE_IMAGE_SRC_ATTRIBUTE]?: string;
	[FILE_SOURCE_DESCRIPTOR_ATTRIBUTE]?: string;
	node?: unknown;
};

/**
 * Renders a `<picture>` source whose `srcset` names a workspace file, drawn from
 * that file's bytes.
 *
 * A README swaps in its dark screenshot this way, and the path it writes
 * resolves against the app bundle rather than against the document — so the
 * source that matches fails, and the failure lands on the picture's `<img>`,
 * which then draws nothing. A source still being read, or one that cannot be
 * read at all, renders nothing: the picture then falls back to its `<img>`,
 * which is the author's own answer for a source that does not apply.
 */
export function MarkdownPictureSource({
	[FILE_IMAGE_SRC_ATTRIBUTE]: reference = '',
	[FILE_SOURCE_DESCRIPTOR_ATTRIBUTE]: descriptor,
	node: _node,
	...props
}: MarkdownPictureSourceProps) {
	const { source } = useMarkdownImageSource(reference);
	if (!source) {
		return null;
	}
	return (
		<source
			{...props}
			srcSet={descriptor ? `${source} ${descriptor}` : source}
		/>
	);
}
