import { MinusIcon, PlusIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useId } from 'react';
import { useAnchoredDisclosure } from '@/renderer/hooks/conversation/use-anchored-disclosure';
import { cn } from '@/renderer/lib/utils';
import type { ToolGlyph, ToolTone } from '@/renderer/types/tool-presentation';
import { GLYPH_ICONS } from './tool-collapsible/glyph-icons';

/** Shape of a {@link ToolCollapsible} row. */
interface ToolCollapsibleProps {
	children: ReactNode;
	/** Suppresses the disclosure control for a row with nothing to disclose. */
	disabled?: boolean;
	glyph: ToolGlyph;
	/** Pulses the row while the call is still in flight. */
	pending?: boolean;
	title: string;
	/** Tints the icon and title; `destructive` marks a failed call. */
	tone?: ToolTone;
	/** Persistent context such as a file chip; stays put when the row expands. */
	toolBadge?: ReactNode;
	/** Collapsed-only summary of what the body will show, e.g. the command run. */
	toolPreview?: ReactNode;
}

/**
 * One tool call in the timeline. Every tool row is this component with
 * different props — it owns the row chrome, and the caller supplies the
 * identity and the body.
 *
 * Layout is title, then badge, then preview. Only the icon and title sit inside
 * the disclosure button, so the hover surface hugs them rather than filling the
 * row — that leaves the badge free to hold its own controls, which a nested
 * button could not do.
 *
 * Opening a row keeps the row itself still: the body unfolds beneath the
 * heading instead of the transcript sliding down to its newest message.
 *
 * A disabled row drops `aria-controls` rather than pointing at the body id: the
 * body element exists only while the row is open, so naming it there would leave
 * an idref that never resolves.
 */
export function ToolCollapsible({
	children,
	disabled = false,
	glyph,
	pending = false,
	title,
	tone = 'default',
	toolBadge,
	toolPreview,
}: ToolCollapsibleProps) {
	const { isOpen: open, rowRef, toggle } = useAnchoredDisclosure();
	const bodyId = useId();
	const ToolIcon = GLYPH_ICONS[glyph];
	const DisclosureIcon = open ? MinusIcon : PlusIcon;
	const isOpen = open && !disabled;

	return (
		<div
			className='relative flex justify-start'
			data-role='activity-row'
			ref={rowRef}
		>
			<div className='wrap-break-word flex w-full max-w-xl flex-col space-y-1 lg:max-w-3xl'>
				<div className='group/collapsible flex max-w-full items-center gap-2'>
					<button
						aria-controls={disabled ? undefined : bodyId}
						aria-expanded={isOpen}
						className={cn(
							'group/disclosure -ml-1.5 flex shrink-0 items-center gap-2 rounded-sm px-1.5 py-1 text-left',
							disabled ? 'cursor-default' : 'cursor-pointer hover:bg-muted/50',
						)}
						disabled={disabled}
						onClick={toggle}
						type='button'
					>
						<span className='relative shrink-0'>
							<span
								className={cn(
									'block',
									!disabled &&
										'group-hover/disclosure:opacity-0 group-has-[.filebadge:hover]/collapsible:opacity-100',
								)}
							>
								<ToolIcon
									aria-hidden='true'
									className={cn(
										'size-3',
										pending && 'animate-pulse',
										tone === 'destructive'
											? 'text-destructive'
											: 'text-muted-foreground',
									)}
								/>
							</span>
							{disabled ? null : (
								<DisclosureIcon
									aria-hidden='true'
									className='absolute inset-0 m-auto hidden size-3 text-muted-foreground group-hover/disclosure:block group-has-[.filebadge:hover]/collapsible:hidden'
								/>
							)}
						</span>
						<span
							className={cn(
								'truncate text-sm',
								pending && 'animate-pulse text-muted-foreground',
								tone === 'destructive' && 'text-destructive',
							)}
						>
							{title}
						</span>
					</button>
					{toolBadge ? (
						<div className='flex min-w-0 items-center'>{toolBadge}</div>
					) : null}
					{!isOpen && toolPreview ? (
						<div className='min-w-0 max-w-100 truncate font-medium font-mono text-muted-foreground text-xs'>
							{toolPreview}
						</div>
					) : null}
				</div>
				{isOpen ? (
					<div className='mt-2 select-text' id={bodyId}>
						{children}
					</div>
				) : null}
			</div>
		</div>
	);
}
