import type { TFunction } from 'i18next';
import { useAtomValue } from 'jotai';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
	ContextMenu,
	ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { useTerminalSelectionMenu } from '@/renderer/hooks/workbench-shell/dock-panel/use-terminal-selection-menu';
import { emitTerminalInput } from '@/renderer/lib/terminal';
import {
	createXtermAdapter,
	DEFAULT_FONT_FAMILY,
} from '@/renderer/lib/terminal/xterm-adapter';
import {
	terminalFontAtom,
	terminalFontSizeAtom,
	terminalScrollbackMbAtom,
} from '@/renderer/state/preferences';
import type { TerminalRendererAdapter } from '@/renderer/types/terminal';
import type { TerminalSessionStatus } from '@/shared/ipc/contracts/terminal';
import { scrollbackMbToLines } from '@/shared/terminal';

import { TerminalContextMenuContent } from './terminal-context-menu';

/** Builds the terminal CSS font stack, prepending the user's chosen font. */
function buildTerminalFontFamily(font: string): string {
	const trimmed = font.trim();
	return trimmed && trimmed !== 'JetBrainsMono Nerd Font Mono'
		? `"${trimmed}", ${DEFAULT_FONT_FAMILY}`
		: DEFAULT_FONT_FAMILY;
}

/**
 * One live xterm.js surface bound to a main-process PTY session: replays the
 * scrollback snapshot, streams output broadcasts, forwards keystrokes, and
 * keeps PTY dimensions in sync with the panel size. When `readOnly` is set the
 * surface streams output but never forwards input (Setup/Run panels).
 *
 * Right-clicking hands the current selection to the chat as an attachment chip.
 */
export function XtermTerminal({
	readOnly = false,
	sessionStatus,
	terminalId,
	terminalLabel,
	workspaceCwd,
}: {
	readOnly?: boolean;
	sessionStatus: TerminalSessionStatus | null;
	terminalId: string;
	/** What this pane calls itself, which names an attached selection. */
	terminalLabel: string;
	workspaceCwd: string;
}) {
	const { t } = useTranslation();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const adapterRef = useRef<TerminalRendererAdapter | null>(null);
	const { onCloseAutoFocus, onOpenChange, selection } =
		useTerminalSelectionMenu({ adapterRef, readOnly });
	const terminalFont = useAtomValue(terminalFontAtom);
	const terminalFontSize = useAtomValue(terminalFontSizeAtom);
	const terminalScrollbackMb = useAtomValue(terminalScrollbackMbAtom);
	const fontFamily = buildTerminalFontFamily(terminalFont);
	const scrollbackLines = scrollbackMbToLines(terminalScrollbackMb);
	// Scrollback line count captured at construction; later changes are live-applied
	// by the effect below (never remounting the surface), mirroring typography.
	const scrollbackRef = useRef(scrollbackLines);
	const appliedScrollbackRef = useRef(scrollbackLines);
	// Latest typography, read at construction without re-mounting the surface on
	// every font/size change (that is handled by the separate effect below).
	const fontRef = useRef({ fontFamily, fontSize: terminalFontSize });
	useEffect(() => {
		fontRef.current = { fontFamily, fontSize: terminalFontSize };
	});
	// Typography the live adapter already reflects. Seeded with the construction
	// values so the live-apply effect skips its redundant first run (and any
	// remount that rebuilds the adapter with the same font).
	const appliedFontRef = useRef({ fontFamily, fontSize: terminalFontSize });
	// The exit banner is for interactive terminals only. Setup/Run script panels
	// (read-only) surface lifecycle controls and status in their panel chrome, so
	// the footer would be redundant noise there.
	const exitNotice = readOnly ? null : formatExitNotice(sessionStatus, t);

	useEffect(() => {
		const container = containerRef.current;

		if (!container || !window.ensemblr) {
			return;
		}

		const ensemblr = window.ensemblr;
		const adapter = createXtermAdapter({
			fontFamily: fontRef.current.fontFamily,
			fontSize: fontRef.current.fontSize,
			readOnly,
			scrollback: scrollbackRef.current,
		});
		adapterRef.current = adapter;
		adapter.attach(container);

		let disposed = false;
		let replayed = false;
		// Chunks broadcast while the snapshot request is in flight. Each carries
		// its sequence number so chunks already folded into the snapshot's
		// scrollback are dropped instead of replayed twice.
		const bufferedChunks: Array<{ data: string; seq: number }> = [];

		const unsubscribeOutput = ensemblr.onTerminalOutput((event) => {
			if (event.terminalId !== terminalId) {
				return;
			}

			if (replayed) {
				adapter.write(event.data);
			} else {
				bufferedChunks.push({ data: event.data, seq: event.seq });
			}
		});
		// Read-only panels (Setup/Run output) stream output but never forward
		// keystrokes: skip the input subscription entirely.
		const unsubscribeInput = readOnly
			? null
			: adapter.onData((data) => {
					emitTerminalInput({ data, terminalId });
					void ensemblr.writeTerminalSession({ data, terminalId });
				});

		ensemblr
			.terminalSnapshot({ terminalId })
			.then((snapshot) => {
				if (disposed) {
					return;
				}

				if (snapshot.scrollback) {
					adapter.write(snapshot.scrollback);
				}

				for (const chunk of bufferedChunks) {
					if (chunk.seq > snapshot.lastSeq) {
						adapter.write(chunk.data);
					}
				}

				replayed = true;
				bufferedChunks.length = 0;
			})
			.catch(() => {
				replayed = true;
			});

		const syncDimensions = () =>
			syncTerminalDimensions(adapter, container, terminalId);

		syncDimensions();

		void adapter.whenFontReady().then(() => {
			if (!disposed) {
				syncDimensions();
			}
		});

		// Read-only panels never grab keyboard focus from the composer.
		if (!readOnly) {
			adapter.focus();
		}

		const resizeObserver = new ResizeObserver(() => syncDimensions());
		resizeObserver.observe(container);

		return () => {
			disposed = true;
			resizeObserver.disconnect();
			unsubscribeOutput();
			unsubscribeInput?.();
			adapter.dispose();
			adapterRef.current = null;
		};
	}, [readOnly, terminalId]);

	// Live-apply terminal font/size changes to the already-mounted surface so the
	// Appearance settings take effect without recreating the PTY binding. Each
	// open terminal runs this independently, then re-fits and resizes its session.
	useEffect(() => {
		const adapter = adapterRef.current;
		const container = containerRef.current;

		if (!adapter || !container || !window.ensemblr) {
			return;
		}

		// The mount effect already built the adapter with the current typography
		// and fitted it; only re-apply when the font or size actually changed.
		const applied = appliedFontRef.current;
		if (
			applied.fontFamily === fontFamily &&
			applied.fontSize === terminalFontSize
		) {
			return;
		}
		appliedFontRef.current = { fontFamily, fontSize: terminalFontSize };

		adapter.setFont({ fontFamily, fontSize: terminalFontSize });
		syncTerminalDimensions(adapter, container, terminalId);

		// Not redundant: the fit above measured whatever faces were rasterizable
		// then, and a face landing later moves the cell box and the column count.
		void adapter.whenFontReady().then(() => {
			if (adapterRef.current === adapter) {
				syncTerminalDimensions(adapter, container, terminalId);
			}
		});
	}, [fontFamily, terminalFontSize, terminalId]);

	useEffect(() => {
		const adapter = adapterRef.current;
		if (!adapter || appliedScrollbackRef.current === scrollbackLines) {
			return;
		}
		appliedScrollbackRef.current = scrollbackLines;
		adapter.setScrollback(scrollbackLines);
	}, [scrollbackLines]);

	return (
		<ContextMenu onOpenChange={onOpenChange}>
			<ContextMenuTrigger asChild>
				<div className='relative h-full min-h-0 w-full bg-sidebar'>
					<div
						className='h-full min-h-0 w-full px-2 pt-1 pb-3'
						ref={containerRef}
					/>
					{exitNotice ? (
						<div className='pointer-events-none absolute inset-x-0 bottom-0 border-border border-t bg-muted/80 px-3 py-1 text-muted-foreground text-xs'>
							{exitNotice}
						</div>
					) : null}
				</div>
			</ContextMenuTrigger>
			<TerminalContextMenuContent
				onCloseAutoFocus={onCloseAutoFocus}
				selection={selection}
				terminalLabel={terminalLabel}
				workspaceCwd={workspaceCwd}
			/>
		</ContextMenu>
	);
}

/**
 * Fits the surface to its container and hands the resulting geometry to the
 * PTY, so the shell wraps at the width the user actually sees.
 *
 * A force-mounted hidden tab has a zero-size container, and fitting against one
 * collapses the session to minimum dimensions and garbles the wrapping of
 * everything already on screen — so that case is left for the ResizeObserver to
 * pick up once the pane has a size.
 * @param adapter - The live terminal surface to fit.
 * @param container - The element the surface fills.
 * @param terminalId - Session whose PTY geometry follows the fit.
 */
function syncTerminalDimensions(
	adapter: TerminalRendererAdapter,
	container: HTMLElement,
	terminalId: string,
): void {
	if (container.clientHeight === 0 || container.clientWidth === 0) {
		return;
	}

	const dimensions = adapter.fit();

	if (!dimensions) {
		return;
	}

	void window.ensemblr?.resizeTerminalSession({
		cols: dimensions.cols,
		rows: dimensions.rows,
		terminalId,
	});
}

/**
 * Human-readable banner shown when the session is no longer running.
 * @param status - The session's last reported status
 * @param t - The caller's translation function, so the copy follows the UI language
 * @returns The banner text, or null while the session is still running
 */
function formatExitNotice(
	status: TerminalSessionStatus | null,
	t: TFunction,
): string | null {
	switch (status) {
		case 'exited':
			return t('workbench:terminal.session-ended', 'Session ended.');
		case 'failed':
			return t('workbench:terminal.session-failed', 'Session failed.');
		case 'stopped':
			return t('workbench:terminal.session-stopped', 'Session stopped.');
		default:
			return null;
	}
}
