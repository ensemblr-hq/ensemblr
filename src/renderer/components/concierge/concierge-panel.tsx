import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { TextContextMenu } from '@/renderer/components/text-context-menu';
import { Button } from '@/renderer/components/ui/button';
import { useConciergePanel } from '@/renderer/hooks/concierge/use-concierge-panel';
import { useConciergeReferenceOpen } from '@/renderer/hooks/concierge/use-concierge-reference-open';
import { cn } from '@/renderer/lib/utils';
import type { ConciergeSize } from '@/renderer/state/concierge';
import { ConciergeClearConfirmDialog } from './concierge-clear-confirm-dialog';
import { ConciergeComposer } from './concierge-composer';
import { ConciergeFilePreview } from './concierge-file-preview';
import { ConciergePanelHeader } from './concierge-panel-header';
import { ConciergeQuestionSlot } from './concierge-question-slot';
import { ConciergeReferenceProvider } from './concierge-reference-context';
import { ConciergeResizeHandles } from './concierge-resize-handles';
import { ConciergeSidebarRail } from './concierge-sidebar-rail';
import { ConciergeTimeline } from './concierge-timeline';

/**
 * The Concierge conversation surface: a docked card the user can drag anywhere
 * and resize from its leading edges, which expands to take over the shell's
 * content area.
 *
 * Presentation is a single atom rather than two booleans so the three states
 * cannot contradict each other, and the panel mounts only while it is open —
 * which is also what keeps the session shut until somebody asks for it.
 * Everything behind the surface — the session, the context gauge, the placement,
 * the size, and the two chords that need a live conversation — is resolved by
 * {@link useConciergePanel}, leaving this to render it.
 *
 * Maximizing covers the `SidebarInset` rather than the viewport, so the
 * navigation sidebar stays reachable and the user can still switch projects with
 * the Concierge open. The rectangle is measured rather than derived from the
 * sidebar's width variable, which has three values and animates between them.
 * A collapsed sidebar leaves that inset spanning the whole window, so what the
 * covered neighbour would have drawn is drawn here instead:
 * {@link ConciergePanelHeader} takes the window controls' safe inset and the
 * trigger that brings the sidebar back, and {@link ConciergeSidebarRail}
 * replaces the hover strip along the same edge.
 */
export function ConciergePanel() {
	const { t } = useTranslation();
	const panel = useConciergePanel();
	const referenceAccess = useConciergeReferenceOpen(
		panel.presentation !== 'closed',
	);

	if (panel.presentation === 'closed') {
		return null;
	}

	const { isFullscreen, session } = panel;

	return (
		// Wraps the transcript *and* the composer: a chip in an answer and a chip in
		// the draft are the same object, and the composer sits outside the providers
		// the timeline mounts for itself.
		<ConciergeReferenceProvider value={referenceAccess}>
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
				style={panelStyle({
					insetRect: panel.insetRect,
					isFullscreen,
					size: panel.resize.size,
				})}
				tabIndex={-1}
			>
				<ConciergePanelHeader
					insetLeft={panel.insetRect?.left ?? null}
					isClearing={session.isClearing}
					isFullscreen={isFullscreen}
					onClear={panel.clearContext}
					onClose={panel.closePanel}
					onPointerDown={panel.anchor.onPointerDown}
					onToggleFullscreen={panel.toggleFullscreen}
				/>

				{panel.showClearBanner ? (
					<div className='flex shrink-0 items-center gap-2 border-status-warning/30 border-b bg-status-warning/10 px-3 py-2 text-status-warning text-xs'>
						<p className='min-w-0 flex-1'>
							{t(
								'workbench:concierge.panel.pressure',
								'Context is filling up. Clearing starts a fresh conversation right away; this one writes to memory in the background.',
							)}
						</p>
						<Button
							className='shrink-0'
							disabled={session.isClearing}
							onClick={() => panel.requestClear({ reason: 'threshold' })}
							size='xs'
							variant='secondary'
						>
							{t('workbench:concierge.panel.pressure-clear', 'Clear now')}
						</Button>
						<Button
							className='shrink-0'
							onClick={panel.dismissBanner}
							size='xs'
							variant='ghost'
						>
							{t('workbench:concierge.panel.pressure-dismiss', 'Not yet')}
						</Button>
					</div>
				) : null}

				{/* Wrapped like the transcript is: a failure sentence is the line most
				    likely to end up pasted into a bug report, and Electron draws no
				    right-click menu of its own. */}
				{session.error ? (
					<TextContextMenu>
						<p
							className='shrink-0 border-status-danger/30 border-b bg-status-danger/10 px-3 py-2 text-status-danger text-xs'
							role='alert'
						>
							{session.error}
						</p>
					</TextContextMenu>
				) : null}

				{/* The preview covers the transcript and nothing else: the header keeps
				    the close and maximize controls reachable, and the composer stays
				    live so a question about what is on screen can be asked without
				    dismissing it first. */}
				<div className='relative flex min-h-0 flex-1 flex-col'>
					<ConciergeTimeline
						centered={isFullscreen}
						events={session.events}
						home={session.cwd}
						isStreaming={session.isStreaming}
					/>
					<ConciergeFilePreview home={session.cwd} />
				</div>

				{isFullscreen ? (
					<ConciergeSidebarRail />
				) : (
					<ConciergeResizeHandles resize={panel.resize} />
				)}

				<ConciergeQuestionSlot agentSessionId={session.sessionId} />

				<ConciergeComposer
					centered={isFullscreen}
					cwd={session.cwd ?? ''}
					disabled={
						session.sessionId === null ||
						session.isOpening ||
						session.isClearing ||
						!session.cwd
					}
					isStreaming={session.isStreaming}
					onStop={() => void session.stop()}
					onSubmit={(prompt, selection) =>
						void session.submit(prompt, selection)
					}
				/>
			</section>
			<ConciergeClearConfirmDialog
				onCancel={panel.clearConfirmation.cancel}
				onConfirm={panel.clearConfirmation.confirm}
				open={panel.clearConfirmation.open}
			/>
		</ConciergeReferenceProvider>
	);
}

/**
 * Sizes the panel and, maximized, places it over the shell's content area.
 *
 * Docked, `left` and `top` are deliberately absent: the anchor hook writes them
 * onto the node so a drag does not have to round-trip through React, and a value
 * here would fight it on every render the streaming transcript causes. The
 * width and height are React's, because a resize commits them on pointer-up and
 * the anchor reads the committed pair back to place the panel.
 * @param input - The measured inset, the docked size, and whether the panel is maximized.
 * @returns The inline style to apply.
 */
function panelStyle({
	insetRect,
	isFullscreen,
	size,
}: {
	insetRect: {
		height: number;
		left: number;
		top: number;
		width: number;
	} | null;
	isFullscreen: boolean;
	size: ConciergeSize;
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
		height: size.height,
		maxHeight: 'calc(100vh - 1rem)',
		maxWidth: 'calc(100vw - 1rem)',
		width: size.width,
	};
}
