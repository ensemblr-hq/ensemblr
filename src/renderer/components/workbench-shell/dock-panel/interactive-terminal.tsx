import type { TerminalDockTabModel } from '@/renderer/types/workbench';

import { LogDockContent } from './log-content';

/** Interactive terminal tab content (one session id per tab). */
export function InteractiveTerminalPanel({
	tab,
}: {
	tab: TerminalDockTabModel;
}) {
	return (
		<LogDockContent
			lines={tab.lines}
			sessionId={tab.sessionId}
			title={tab.label}
		/>
	);
}
