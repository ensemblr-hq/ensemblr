import type { WorkspaceScriptSummary } from '@/renderer/types/workbench';

import { RunStoppedEmptyState } from './run-stopped-empty-state';
import { ScriptEmptyState } from './script-empty-state';
import { XtermTerminal } from './xterm-terminal';

/** Renders the Run script output or the appropriate empty state. */
export function RunScriptOutputPanel({
	onOpenSetupScripts,
	onRunScript,
	script,
}: {
	onOpenSetupScripts: () => void;
	onRunScript: () => void;
	script: WorkspaceScriptSummary;
}) {
	if (script.status === 'missing') {
		return (
			<ScriptEmptyState
				actionLabel='Setup Scripts'
				detail='Add a run script for the normal dev server, watcher, worker, or local app command.'
				onAction={onOpenSetupScripts}
				title='No run script configured'
			/>
		);
	}

	if (!script.terminalId) {
		return <RunStoppedEmptyState onRunScript={onRunScript} />;
	}

	return (
		<XtermTerminal
			readOnly
			sessionStatus={script.sessionStatus ?? null}
			terminalId={script.terminalId}
		/>
	);
}
