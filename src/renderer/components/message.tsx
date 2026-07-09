'use client';

import { cjk } from '@streamdown/cjk';
import { createCodePlugin } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import { useAtomValue } from 'jotai';
import type { ComponentProps } from 'react';
import { memo, useMemo } from 'react';
import { Streamdown } from 'streamdown';
import { cn } from '@/renderer/lib/utils';
import { codeThemeAtom, markdownStyleAtom } from '@/renderer/state/preferences';

type MessageResponseProps = ComponentProps<typeof Streamdown>;

export const MessageResponse = memo(
	({ className, ...props }: MessageResponseProps) => {
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
