import { GripVertical, Maximize2, Minimize2, RotateCcw, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/renderer/components/ui/button';
import { SidebarTrigger, useSidebar } from '@/renderer/components/ui/sidebar';
import {
	PANEL_SIZE,
	useConciergePanel,
} from '@/renderer/hooks/concierge/use-concierge-panel';
import { cn } from '@/renderer/lib/utils';
import { ConciergeComposer } from './concierge-composer';
import { ConciergeTimeline } from './concierge-timeline';

/**
 * Width in pixels the macOS window controls claim at the window's leading edge,
 * matching the `--ensemblr-traffic-light-safe-inline` token the shell toolbars
 * pad by. A maximized panel starting left of this sits under the controls.
 */
const TRAFFIC_LIGHT_SAFE_INLINE = 92;

/**
 * The Concierge conversation surface: a docked card the user can drag anywhere,
 * which expands to take over the shell's content area.
 *
 * Presentation is a single atom rather than two booleans so the three states
 * cannot contradict each other, and the panel mounts only while it is open —
 * which is also what keeps the session shut until somebody asks for it.
 * Everything behind the surface — the session, the context gauge, the placement,
 * and the two chords that need a live conversation — is resolved by
 * {@link useConciergePanel}, leaving this to render it.
 *
 * Maximizing covers the `SidebarInset` rather than the viewport, so the
 * navigation sidebar stays reachable and the user can still switch projects with
 * the Concierge open. The rectangle is measured rather than derived from the
 * sidebar's width variable, which has three values and animates between them.
 * A collapsed sidebar leaves that inset spanning the whole window, which is why
 * the maximized header takes over both jobs its neighbour would have done: the
 * window controls' safe inset, and the trigger that brings the sidebar back.
 */
export function ConciergePanel() {
	const { t } = useTranslation();
	const { state: sidebarState, toggleSidebar } = useSidebar();
	const panel = useConciergePanel();

	if (panel.presentation === 'closed') {
		return null;
	}

	const { isFullscreen, session } = panel;
	const sidebarIsCollapsed = sidebarState === 'collapsed';
	const expandSidebarLabel = t(
		'workbench:concierge.panel.expand-sidebar',
		'Show the sidebar',
	);
	const sidebarEdgeLabel = sidebarIsCollapsed
		? expandSidebarLabel
		: t('workbench:concierge.panel.collapse-sidebar', 'Hide the sidebar');
	const clearsTrafficLights =
		(panel.insetRect?.left ?? 0) >= TRAFFIC_LIGHT_SAFE_INLINE;

	return (
		<section
			aria-label={t('workbench:concierge.panel.label', 'Concierge')}
			className={cn(
				'fixed z-50 flex flex-col overflow-hidden bg-background outline-none',
				// Maximized, the panel fills the shell inset, whose edges the sidebar
				// already draws — a border of its own doubles that divider and pushes
				// the header down a pixel out of line with the sidebar's own header.
				isFullscreen
					? 'rounded-none'
					: 'rounded-xl border border-border/60 shadow-lg',
			)}
			data-concierge-presentation={panel.presentation}
			onKeyDown={panel.handleKeyDown}
			ref={panel.anchor.ref}
			style={panelStyle({ insetRect: panel.insetRect, isFullscreen })}
			tabIndex={-1}
		>
			<header
				className={cn(
					'flex shrink-0 items-center gap-1 border-b',
					// Maximized, this header sits beside the sidebar's own — so it takes
					// the shell toolbar's height, padding, and full-strength border, or
					// the two rules miss each other and the title crowds the divider.
					// With that sidebar collapsed there is no header beside it and the
					// macOS window controls, which draw above the web contents, land on
					// the title — so it pads by the same safe inset the shell's leading
					// toolbar takes.
					isFullscreen
						? cn(
								'h-12 border-border pr-3',
								clearsTrafficLights
									? 'pl-3'
									: 'pl-[var(--ensemblr-traffic-light-safe-inline)]',
							)
						: 'cursor-grab border-border/60 py-2 pr-2 pl-1 active:cursor-grabbing',
				)}
				onPointerDown={panel.anchor.onPointerDown}
			>
				{isFullscreen ? null : (
					<GripVertical
						aria-hidden='true'
						className='size-4 shrink-0 text-muted-foreground/60'
					/>
				)}
				{isFullscreen && sidebarIsCollapsed ? (
					<SidebarTrigger aria-label={expandSidebarLabel} className='mr-1' />
				) : null}
				<h2 className='flex-1 truncate font-medium text-sm'>
					{t('workbench:concierge.panel.title', 'Concierge')}
				</h2>
				<Button
					aria-label={t(
						'workbench:concierge.panel.clear',
						'Clear context and start over',
					)}
					disabled={session.isClearing}
					onClick={panel.clearContext}
					onPointerDown={stopDragPropagation}
					size='icon'
					variant='ghost'
				>
					<RotateCcw aria-hidden='true' className='size-4' />
				</Button>
				<Button
					aria-label={
						isFullscreen
							? t('workbench:concierge.panel.restore', 'Restore panel')
							: t('workbench:concierge.panel.maximize', 'Maximize')
					}
					onClick={panel.toggleFullscreen}
					onPointerDown={stopDragPropagation}
					size='icon'
					variant='ghost'
				>
					{isFullscreen ? (
						<Minimize2 aria-hidden='true' className='size-4' />
					) : (
						<Maximize2 aria-hidden='true' className='size-4' />
					)}
				</Button>
				<Button
					aria-label={t('common:actions.close', 'Close')}
					onClick={panel.close}
					onPointerDown={stopDragPropagation}
					size='icon'
					variant='ghost'
				>
					<X aria-hidden='true' className='size-4' />
				</Button>
			</header>

			{panel.showClearBanner ? (
				<div className='flex items-center gap-2 border-status-warning/30 border-b bg-status-warning/10 px-3 py-2 text-status-warning text-xs'>
					<p className='flex-1'>
						{t(
							'workbench:concierge.panel.pressure',
							'Context is filling up. Clearing now writes what was learned to memory first.',
						)}
					</p>
					<Button
						disabled={session.isClearing}
						onClick={() => void session.clear({ reason: 'threshold' })}
						size='sm'
						variant='secondary'
					>
						{t('workbench:concierge.panel.pressure-clear', 'Clear now')}
					</Button>
					<Button onClick={panel.dismissBanner} size='sm' variant='ghost'>
						{t('workbench:concierge.panel.pressure-dismiss', 'Not yet')}
					</Button>
				</div>
			) : null}

			{session.error ? (
				<p className='border-status-danger/30 border-b bg-status-danger/10 px-3 py-2 text-status-danger text-xs'>
					{session.error}
				</p>
			) : null}

			<ConciergeTimeline
				centered={isFullscreen}
				events={session.events}
				isStreaming={session.isStreaming}
			/>

			{/* Maximized, the panel covers the sidebar's rail — the strip every other
			    screen lets you hover and click to open or close it — so it carries a
			    rail of its own along the same edge, lighting the same rule the shell's
			    does: the sidebar's border while it is open, the panel's own edge once
			    it is closed. */}
			{isFullscreen ? (
				<button
					aria-label={sidebarEdgeLabel}
					className={cn(
						'absolute inset-y-0 left-0 z-10 hidden w-2 transition-all ease-linear after:absolute after:inset-y-0 after:w-0.5 hover:after:bg-sidebar-border sm:block',
						sidebarIsCollapsed
							? 'after:left-full after:-translate-x-px hover:bg-sidebar'
							: 'after:-left-px',
					)}
					onClick={toggleSidebar}
					tabIndex={-1}
					title={sidebarEdgeLabel}
					type='button'
				/>
			) : null}

			<ConciergeComposer
				centered={isFullscreen}
				cwd={session.cwd ?? ''}
				disabled={
					session.sessionId === null || session.isOpening || !session.cwd
				}
				isStreaming={session.isStreaming}
				onStop={() => void session.stop()}
				onSubmit={(prompt, selection) => void session.submit(prompt, selection)}
			/>
		</section>
	);
}

/**
 * Sizes the panel and, maximized, places it over the shell's content area.
 *
 * Docked, `left` and `top` are deliberately absent: the anchor hook writes them
 * onto the node so a drag does not have to round-trip through React, and a value
 * here would fight it on every render the streaming transcript causes.
 * @param input - The measured inset and whether the panel is maximized.
 * @returns The inline style to apply.
 */
function panelStyle({
	insetRect,
	isFullscreen,
}: {
	insetRect: {
		height: number;
		left: number;
		top: number;
		width: number;
	} | null;
	isFullscreen: boolean;
}): CSSProperties {
	if (isFullscreen && insetRect) {
		return {
			height: insetRect.height,
			left: insetRect.left,
			top: insetRect.top,
			width: insetRect.width,
		};
	}
	if (isFullscreen) {
		return { inset: 0 };
	}
	return {
		height: PANEL_SIZE.height,
		maxHeight: 'calc(100vh - 2rem)',
		maxWidth: 'calc(100vw - 2rem)',
		width: PANEL_SIZE.width,
	};
}

/**
 * Keeps a header control's press from starting a drag of the whole panel.
 * @param event - The pointer-down on the control.
 */
function stopDragPropagation(event: { stopPropagation: () => void }): void {
	event.stopPropagation();
}
