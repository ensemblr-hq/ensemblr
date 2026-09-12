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
import { subscribeTerminalOutput } from '@/renderer/lib/terminal/terminal-output-bus';
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

/**
 * Largest slice of pasted input forwarded to the PTY in one IPC message.
 *
 * xterm hands a paste to `onData` whole, so without this a 100 MB clipboard
 * would be structured-cloned across the bridge and materialized in the main
 * process before the service's own 64 KiB cap could refuse it — the memory
 * spike and serialization stall that cap exists to prevent. Half the cap, so a
 * chunk is never the thing that trips it.
 */
const MAX_INPUT_CHUNK_LENGTH = 32_768;

/**
 * How long a tab stays GPU-accelerated after it is hidden.
 *
 * Cycling through tabs would otherwise tear down and rebuild a WebGL context
 * per keystroke of the tab shortcut; a few seconds covers a round trip without
 * holding a context for a tab the user has actually left.
 */
const RENDERER_HIDE_GRACE_MS = 5_000;

/**
 * Forwards terminal input to the main process in bounded, ordered slices.
 *
 * Each slice is awaited before the next is sent: a shell reads its input as a
 * stream, so a reordered pair of chunks is corrupted input rather than slow
 * input.
 * @param terminalId - Session the input belongs to.
 * @param data - Raw input as xterm produced it.
 */
async function writeTerminalInput(
	terminalId: string,
	data: string,
): Promise<void> {
	for (let offset = 0; offset < data.length; offset += MAX_INPUT_CHUNK_LENGTH) {
		await window.ensemblr?.writeTerminalSession({
			data: data.slice(offset, offset + MAX_INPUT_CHUNK_LENGTH),
			terminalId,
		});
	}
}

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
	isVisible = true,
	readOnly = false,
	sessionStatus,
	terminalId,
	terminalLabel,
	workspaceCwd,
}: {
	/**
	 * Whether the pane is on screen. Defaults to true for a surface that is
	 * conditionally rendered, and so is visible whenever it is mounted; the dock
	 * force-mounts every tab and passes the real state.
	 */
	isVisible?: boolean;
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
	// Geometry the PTY was last told about, so a fit that lands on the same cell
	// grid costs neither an IPC round trip nor a SIGWINCH. Shared by the mount,
	// resize and typography paths, all of which fit the same surface.
	const sentDimensionsRef = useRef({ cols: 0, rows: 0 });
	// Visibility read at construction, so a surface that mounts already on screen
	// takes its GPU context with the rest of its setup rather than waiting for the
	// effect below to see a change that never comes.
	const isVisibleRef = useRef(isVisible);
	useEffect(() => {
		isVisibleRef.current = isVisible;
	});
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
		adapter.setRendererVisible(isVisibleRef.current);

		let disposed = false;
		let replayed = false;
		// Chunks broadcast while the snapshot request is in flight. Each carries
		// its sequence number so chunks already folded into the snapshot's
		// scrollback are dropped instead of replayed twice.
		const bufferedChunks: Array<{ data: string; seq: number }> = [];
		// Serializes input writes across events as well as within one, so a fast
		// typist's keystroke cannot overtake the tail of a large paste.
		let writeChain: Promise<void> = Promise.resolve();

		const unsubscribeOutput = subscribeTerminalOutput(terminalId, (event) => {
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
					writeChain = writeChain.then(() =>
						writeTerminalInput(terminalId, data),
					);
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

		const sentDimensions = sentDimensionsRef.current;
		sentDimensions.cols = 0;
		sentDimensions.rows = 0;
		let pendingFrame: number | null = null;

		const syncDimensions = () => {
			syncTerminalDimensions(adapter, container, terminalId, sentDimensions);
		};

		// Dragging the dock splitter fires the observer every frame, and each call
		// measures the DOM through `fit()`. Coalescing onto the next frame makes
		// that one measurement per painted frame rather than one per observation.
		const scheduleSync = () => {
			pendingFrame ??= requestAnimationFrame(() => {
				pendingFrame = null;
				syncDimensions();
			});
		};

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

		const resizeObserver = new ResizeObserver(scheduleSync);
		resizeObserver.observe(container);

		return () => {
			disposed = true;
			if (pendingFrame !== null) {
				cancelAnimationFrame(pendingFrame);
			}
			resizeObserver.disconnect();
			unsubscribeOutput();
			unsubscribeInput?.();
			adapter.dispose();
			adapterRef.current = null;
		};
	}, [readOnly, terminalId]);

	// Hand the GPU context back while this tab is hidden, after a grace period so
	// tab-cycling does not thrash it. The surface stays mounted either way: that
	// is what keeps its scrollback and its PTY binding.
	useEffect(() => {
		const adapter = adapterRef.current;

		if (!adapter) {
			return;
		}

		if (isVisible) {
			adapter.setRendererVisible(true);
			return;
		}

		const timer = setTimeout(() => {
			if (adapterRef.current === adapter) {
				adapter.setRendererVisible(false);
			}
		}, RENDERER_HIDE_GRACE_MS);

		return () => clearTimeout(timer);
	}, [isVisible]);

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
		syncTerminalDimensions(
			adapter,
			container,
			terminalId,
			sentDimensionsRef.current,
		);

		// Not redundant: the fit above measured whatever faces were rasterizable
		// then, and a face landing later moves the cell box and the column count.
		void adapter.whenFontReady().then(() => {
			if (adapterRef.current === adapter) {
				syncTerminalDimensions(
					adapter,
					container,
					terminalId,
					sentDimensionsRef.current,
				);
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
 * @param sent - Geometry last sent for this session, updated in place, so a fit
 *   that lands on the same cell grid sends nothing.
 */
function syncTerminalDimensions(
	adapter: TerminalRendererAdapter,
	container: HTMLElement,
	terminalId: string,
	sent: { cols: number; rows: number },
): void {
	if (container.clientHeight === 0 || container.clientWidth === 0) {
		return;
	}

	const dimensions = adapter.fit();

	if (!dimensions) {
		return;
	}

	if (dimensions.cols === sent.cols && dimensions.rows === sent.rows) {
		return;
	}

	sent.cols = dimensions.cols;
	sent.rows = dimensions.rows;

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
