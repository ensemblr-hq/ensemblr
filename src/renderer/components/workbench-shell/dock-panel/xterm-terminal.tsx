import { useEffect, useRef } from 'react';

import {
	createXtermAdapter,
	type TerminalRendererAdapter,
} from '@/renderer/lib/terminal/xterm-adapter';
import type { TerminalSessionStatus } from '@/shared/ipc/contracts/terminal';

/**
 * One live xterm.js surface bound to a main-process PTY session: replays the
 * scrollback snapshot, streams output broadcasts, forwards keystrokes, and
 * keeps PTY dimensions in sync with the panel size.
 */
export function XtermTerminal({
	sessionStatus,
	terminalId,
}: {
	sessionStatus: TerminalSessionStatus | null;
	terminalId: string;
}) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const adapterRef = useRef<TerminalRendererAdapter | null>(null);
	const exitNotice = formatExitNotice(sessionStatus);

	useEffect(() => {
		const container = containerRef.current;

		if (!container || !window.ensemble) {
			return;
		}

		const ensemble = window.ensemble;
		const adapter = createXtermAdapter();
		adapterRef.current = adapter;
		adapter.attach(container);

		let disposed = false;
		let replayed = false;
		// Chunks broadcast while the snapshot request is in flight. Each carries
		// its sequence number so chunks already folded into the snapshot's
		// scrollback are dropped instead of replayed twice.
		const bufferedChunks: Array<{ data: string; seq: number }> = [];

		const unsubscribeOutput = ensemble.onTerminalOutput((event) => {
			if (event.terminalId !== terminalId) {
				return;
			}

			if (replayed) {
				adapter.write(event.data);
			} else {
				bufferedChunks.push({ data: event.data, seq: event.seq });
			}
		});
		const unsubscribeInput = adapter.onData((data) => {
			void ensemble.writeTerminalSession({ data, terminalId });
		});

		ensemble
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
				void ensemble.resizeTerminalSession({
					cols: dimensions.cols,
					rows: dimensions.rows,
					terminalId,
				});
			}
		};

		syncDimensions();
		adapter.focus();

		const resizeObserver = new ResizeObserver(() => syncDimensions());
		resizeObserver.observe(container);

		return () => {
			disposed = true;
			resizeObserver.disconnect();
			unsubscribeOutput();
			unsubscribeInput();
			adapter.dispose();
			adapterRef.current = null;
		};
	}, [terminalId]);

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
