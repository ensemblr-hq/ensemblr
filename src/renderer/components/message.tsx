'use client';

import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import type { ComponentProps } from 'react';
import { memo } from 'react';
import { Streamdown } from 'streamdown';
import { cn } from '@/renderer/lib/utils';

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code, math, mermaid };

export const MessageResponse = memo(
	({ className, ...props }: MessageResponseProps) => (
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
				className,
			)}
			plugins={streamdownPlugins}
			{...props}
		/>
	),
	(prevProps, nextProps) =>
		prevProps.children === nextProps.children &&
		nextProps.isAnimating === prevProps.isAnimating,
);

MessageResponse.displayName = 'MessageResponse';
