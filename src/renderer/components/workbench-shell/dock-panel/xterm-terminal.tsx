import { useAtomValue } from 'jotai';
import { useEffect, useRef } from 'react';
import { emitTerminalInput } from '@/renderer/lib/terminal/terminal-tabs';
import {
	createXtermAdapter,
	DEFAULT_FONT_FAMILY,
} from '@/renderer/lib/terminal/xterm-adapter';
import {
	terminalFontAtom,
	terminalFontSizeAtom,
} from '@/renderer/state/preferences';
import type { TerminalRendererAdapter } from '@/renderer/types/terminal';
import type { TerminalSessionStatus } from '@/shared/ipc/contracts/terminal';

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
 */
export function XtermTerminal({
	readOnly = false,
	sessionStatus,
	terminalId,
}: {
	readOnly?: boolean;
	sessionStatus: TerminalSessionStatus | null;
	terminalId: string;
}) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const adapterRef = useRef<TerminalRendererAdapter | null>(null);
	const terminalFont = useAtomValue(terminalFontAtom);
	const terminalFontSize = useAtomValue(terminalFontSizeAtom);
	const fontFamily = buildTerminalFontFamily(terminalFont);
	// Latest typography, read at construction without re-mounting the surface on
	// every font/size change (that is handled by the separate effect below).
	const fontRef = useRef({ fontFamily, fontSize: terminalFontSize });
	fontRef.current = { fontFamily, fontSize: terminalFontSize };
	// Typography the live adapter already reflects. Seeded with the construction
	// values so the live-apply effect skips its redundant first run (and any
	// remount that rebuilds the adapter with the same font).
	const appliedFontRef = useRef({ fontFamily, fontSize: terminalFontSize });
	// The exit banner is for interactive terminals only. Setup/Run script panels
	// (read-only) surface lifecycle controls and status in their panel chrome, so
	// the footer would be redundant noise there.
	const exitNotice = readOnly ? null : formatExitNotice(sessionStatus);

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

		const syncDimensions = () => {
			// Force-mounted hidden tabs have a zero-size container; fitting then
			// would collapse the PTY to minimum dimensions and garble wrapping.
			if (container.clientHeight === 0 || container.clientWidth === 0) {
				return;
			}

			const dimensions = adapter.fit();

			if (dimensions) {
				void ensemblr.resizeTerminalSession({
					cols: dimensions.cols,
					rows: dimensions.rows,
					terminalId,
				});
			}
		};

		syncDimensions();

		void document.fonts?.ready.then(() => {
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

		if (container.clientHeight === 0 || container.clientWidth === 0) {
			return;
		}

		const dimensions = adapter.fit();

		if (dimensions) {
			void window.ensemblr.resizeTerminalSession({
				cols: dimensions.cols,
				rows: dimensions.rows,
				terminalId,
			});
		}
	}, [fontFamily, terminalFontSize, terminalId]);

	return (
		<div className='relative h-full min-h-0 w-full bg-sidebar'>
			<div className='h-full min-h-0 w-full px-2 py-1' ref={containerRef} />
			{exitNotice ? (
				<div className='pointer-events-none absolute inset-x-0 bottom-0 border-border border-t bg-muted/80 px-3 py-1 text-muted-foreground text-xs'>
					{exitNotice}
				</div>
			) : null}
		</div>
	);
}

/** Human-readable banner shown when the session is no longer running. */
function formatExitNotice(status: TerminalSessionStatus | null): string | null {
	switch (status) {
		case 'exited':
			return 'Session ended.';
		case 'failed':
			return 'Session failed.';
		case 'stopped':
			return 'Session stopped.';
		default:
			return null;
	}
}
