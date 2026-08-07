import type { ReactNode } from 'react';
import { ChatAttachmentChip } from '@/renderer/components/chat-attachment-chip';
import { chipLabelForPath } from '@/renderer/lib/agent-timeline';
import { cn } from '@/renderer/lib/utils';
import type {
	ToolBadgeDescriptor,
	ToolTone,
} from '@/renderer/types/tool-presentation';

/**
 * The default `toolPreview` — an inline pill holding a command, path, failure,
 * or reasoning summary. Long text is safe to pass: the row clips it to one line.
 *
 * Use `font='sans'` when the content is prose rather than code, and
 * `tone='destructive'` on a failure row so the chip matches its tinted title.
 */
export function ToolCommandChip({
	children,
	font = 'mono',
	tone = 'default',
}: {
	children: ReactNode;
	font?: 'mono' | 'sans';
	tone?: ToolTone;
}) {
	return (
		<span
			className={cn(
				'rounded-md px-1 py-0.5 font-medium text-xs',
				font === 'sans' ? 'font-sans' : 'font-mono',
				tone === 'destructive'
					? 'bg-destructive/10 text-destructive'
					: 'bg-muted text-muted-foreground',
			)}
		>
			{children}
		</span>
	);
}

/**
 * Clickable file pill for a tool badge — file-type icon plus the path basename.
 *
 * The `filebadge` class is load-bearing: the row keys a `group-has-[...]` rule
 * off it so hovering the chip holds the tool icon in place instead of flipping
 * it to the disclosure glyph, signalling that a click opens the file rather
 * than toggling the row.
 */
function ToolFileChip({
	kind,
	onActivate,
	path,
}: {
	kind: 'file' | 'folder';
	onActivate?: () => void;
	path: string;
}) {
	return (
		<ChatAttachmentChip
			className='filebadge min-w-0'
			kind={kind}
			label={chipLabelForPath(path)}
			onActivate={onActivate}
			title={path}
		/>
	);
}

/**
 * Standing context for a row that touches a file: the path as a clickable chip
 * plus, when the tool reported a diff, its added and removed line counts.
 *
 * This is a badge rather than a preview so the file stays on screen while the
 * body below it is being read.
 */
export function ToolFileBadge({
	badge,
	onActivate,
}: {
	badge: ToolBadgeDescriptor;
	onActivate?: () => void;
}) {
	const hasCounts = badge.additions !== null || badge.deletions !== null;
	return (
		<span className='flex min-w-0 items-center gap-2'>
			<ToolFileChip
				kind={badge.kind}
				onActivate={onActivate}
				path={badge.path}
			/>
			{hasCounts ? (
				<span className='flex shrink-0 items-center gap-1.5 font-mono text-xxs tabular-nums leading-4'>
					{badge.additions !== null ? (
						<span className='text-diff-addition-foreground'>
							+{badge.additions}
						</span>
					) : null}
					{badge.deletions !== null ? (
						<span className='text-diff-deletion-foreground'>
							-{badge.deletions}
						</span>
					) : null}
				</span>
			) : null}
		</span>
	);
}
