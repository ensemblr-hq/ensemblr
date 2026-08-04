import type { ReactNode } from 'react';
import { cn } from '@/renderer/lib/utils';
import { BlockControls } from '../block-controls';
import { CopyResponseButton } from '../copy-response-button';
import { CODE_CHAT_TEXT_CLASSES, CODE_SURFACE_CLASSES } from './code-style';

/**
 * Scroll shell every conversation-embedded code body sits in. Wrap rows of
 * pre-formatted content in it and the shared chrome comes for free: the app's
 * code surface, a 20rem cap, the app's scrollbars on both axes, and an optional
 * copy control.
 *
 * Scrolls natively under `sleek-scrollbar` rather than through an overlay
 * scroll-area: the file viewer and the diff viewer scroll the same way, and an
 * overlay bar that fades out while idle would leave a chat snippet looking
 * unscrollable next to a panel that always shows how much more there is.
 *
 * Background, border, and default ink come from the app's `code` tokens and so
 * follow light/dark mode; only the syntax colours inside come from the theme
 * picked in Settings → Appearance → Code theme. A panel therefore never paints
 * itself light inside a dark window because a light Shiki theme was chosen.
 *
 * Children must not wrap — the surface scrolls sideways rather than reflowing.
 * For payloads that should wrap, use `ToolPanel` instead.
 *
 * A surface that carries the copy control also carries a floor on its height:
 * a single-line body is shorter than the control itself, which would otherwise
 * be clipped by the rounded overflow.
 */
export function CodeSurface({
	children,
	copyText,
}: {
	children: ReactNode;
	/** Shows a hover-revealed copy button holding this text. */
	copyText?: string;
}) {
	return (
		<div
			className={cn(
				'group/block relative overflow-hidden rounded-md border border-code-border',
				CODE_SURFACE_CLASSES,
				copyText !== undefined && 'flex min-h-10 flex-col justify-center',
			)}
		>
			<div className='sleek-scrollbar max-h-80 overflow-auto overscroll-contain'>
				<div className={cn('min-w-max py-1', CODE_CHAT_TEXT_CLASSES)}>
					{children}
				</div>
			</div>
			{copyText === undefined ? null : (
				<BlockControls>
					<CopyResponseButton label='Copy code' text={copyText} />
				</BlockControls>
			)}
		</div>
	);
}
