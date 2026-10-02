import { ImageOffIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMarkdownImageSource } from '@/renderer/hooks/markdown/use-markdown-image-source';
import { FILE_IMAGE_SRC_ATTRIBUTE } from '@/renderer/lib/markdown-rehype-plugins';
import { cn } from '@/renderer/lib/utils';

/**
 * Props received by Streamdown's image renderer, plus the source the rehype
 * chain moves off `src` for an image the workspace holds.
 */
type MarkdownImageProps = ComponentProps<'img'> & {
	[FILE_IMAGE_SRC_ATTRIBUTE]?: string;
	node?: unknown;
};

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
 * An image whose source is a path rather than a URL is read out of the workspace
 * and drawn from its bytes, because the renderer's own origin is the app bundle
 * and a relative source resolves against that instead of against the document.
 *
 * A remote image is fetched from whatever host wrote it, so it is a read receipt
 * for that host. Deferring the fetch until the image scrolls into view keeps a
 * thread nobody opened from announcing itself, and dropping the referrer keeps
 * the request from carrying where in the app it came from.
 *
 * A source that cannot be drawn is the ordinary case rather than the exception —
 * an expired link, a private asset, a path that moved, an offline machine — and
 * the platform's answer to it is a broken-image glyph that reads as a rendering
 * fault in the app. It falls back to a placeholder carrying the alt text
 * instead, which is the description the author wrote for exactly this.
 */
export function MarkdownImage({
	className,
	node: _node,
	...props
}: MarkdownImageProps) {
	const [failedReference, setFailedReference] = useState<string | null>(null);
	const reference = props[FILE_IMAGE_SRC_ATTRIBUTE] ?? props.src ?? '';
	const { isPending, source } = useMarkdownImageSource(reference);
	if (!reference || isPending) {
		return null;
	}
	if (!source || failedReference === reference) {
		return <ImageUnavailable className={className} description={props.alt} />;
	}
	return (
		<img
			{...props}
			alt={props.alt ?? ''}
			className={cn('inline-block max-w-full align-middle', className)}
			data-streamdown='image'
			loading='lazy'
			onError={() => setFailedReference(reference)}
			referrerPolicy='no-referrer'
			src={source}
		/>
	);
}

/** Stands in for an image that could not be drawn, naming it by its alt text. */
function ImageUnavailable({
	className,
	description,
}: {
	className?: string;
	description?: string;
}) {
	const { t } = useTranslation();
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
				{description
					? t(
							'common:message-image.unavailable-alt',
							'{{description}} (image unavailable)',
							{ description },
						)
					: t('common:message-image.unavailable', 'Image unavailable')}
			</span>
		</span>
	);
}
