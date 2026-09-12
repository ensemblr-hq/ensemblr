import type { ReactNode } from 'react';
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/renderer/lib/utils';
import { BlockControls } from '../block-controls';
import { CopyResponseButton } from '../copy-response-button';
import {
	CODE_CHAT_TEXT_CLASSES,
	CODE_SURFACE_CLASSES,
	CODE_SURFACE_MAX_HEIGHT,
} from './code-style';

/**
 * Pins a scroll container to its last line whenever the content it holds grows,
 * leaving a scroll position the reader chose alone.
 * @param enabled - Whether this surface wants its tail rather than its head
 * @returns Ref to attach to the scroll container
 */
function useTailScroll(enabled: boolean) {
	const scrollerRef = useRef<HTMLDivElement>(null);
	const anchoredHeight = useRef(0);

	useLayoutEffect(() => {
		const scroller = scrollerRef.current;
		if (
			!(enabled && scroller) ||
			scroller.scrollHeight === anchoredHeight.current
		) {
			return;
		}
		anchoredHeight.current = scroller.scrollHeight;
		scroller.scrollTop = scroller.scrollHeight;
	});

	return scrollerRef;
}

/**
 * The wrapping twin of {@link CodeSurface}: the shell every conversation-embedded
 * payload that is not code sits in — a tool call's terminal output, its labelled
 * arguments, its checklist, a diagnostics list, a traceback.
 *
 * Same fill, border, ink, density, height cap, scrollbars, and hover-revealed
 * copy control as the code surface, so a row that shows plain text and a row
 * that shows a highlighted snippet read as one family. The only difference is
 * reflow: children wrap here rather than scrolling sideways, because a command's
 * output has no column grid to preserve.
 *
 * A surface carrying the copy control also carries a floor on its height: the
 * control is absolutely positioned, so a single-line payload would otherwise
 * leave it hanging past the bottom edge.
 */
export function TextSurface({
	children,
	copyText,
	startAtEnd = false,
}: {
	children: ReactNode;
	/** Shows a hover-revealed copy button holding this text. */
	copyText?: string;
	/**
	 * Opens on the payload's last line rather than its first, and returns there
	 * when the payload grows. For command output, where the failure is at the
	 * bottom.
	 */
	startAtEnd?: boolean;
}) {
	const { t } = useTranslation();
	const scrollerRef = useTailScroll(startAtEnd);
	return (
		<div
			className={cn(
				'group/block relative select-text rounded-md border border-code-border p-3',
				CODE_SURFACE_CLASSES,
				CODE_CHAT_TEXT_CLASSES,
				copyText !== undefined && 'flex min-h-10 flex-col justify-center',
			)}
		>
			<div
				className={cn(
					'sleek-scrollbar overflow-auto overscroll-contain',
					CODE_SURFACE_MAX_HEIGHT,
				)}
				ref={scrollerRef}
			>
				{children}
			</div>
			{copyText === undefined ? null : (
				<BlockControls>
					<CopyResponseButton
						label={t('common:actions.copy-output', 'Copy output')}
						text={copyText}
					/>
				</BlockControls>
			)}
		</div>
	);
}
