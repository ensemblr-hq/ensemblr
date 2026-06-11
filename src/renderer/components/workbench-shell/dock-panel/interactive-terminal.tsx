import { SquareTerminalIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { TerminalDockTabModel } from '@/renderer/types/workbench';

import { XtermTerminal } from './xterm-terminal';

/**
 * Interactive terminal tab content. Renders the live xterm surface when the
 * tab is bound to a main-process session. The placeholder default tab spawns
 * its session automatically the first time it becomes visible.
 */
export function InteractiveTerminalPanel({
	isActive,
	onNewTerminal,
	tab,
}: {
	isActive: boolean;
	onNewTerminal: () => void;
	tab: TerminalDockTabModel;
}) {
	// Keyed by tab id so a reconciler-reused instance for a different tab
	// regains its one-shot auto-start.
	const autoStartedTabRef = useRef<string | null>(null);

	useEffect(() => {
		// Dock panels are force-mounted; spawn only when the tab is actually
		// the visible one so opening a workspace doesn't start a shell.
		if (!isActive || tab.terminalId || autoStartedTabRef.current === tab.id) {
			return;
		}

		autoStartedTabRef.current = tab.id;
		onNewTerminal();
	}, [isActive, onNewTerminal, tab.id, tab.terminalId]);

	if (!tab.terminalId) {
		return (
			<div className='flex h-full min-h-0 flex-col items-center justify-center gap-2 p-4 text-center'>
				<SquareTerminalIcon
					aria-hidden='true'
					className='size-6 text-muted-foreground'
				/>
				<p className='text-muted-foreground text-xs'>Starting terminal…</p>
			</div>
		);
	}

	return (
		<XtermTerminal
			sessionStatus={tab.sessionStatus}
			terminalId={tab.terminalId}
		/>
	);
}
