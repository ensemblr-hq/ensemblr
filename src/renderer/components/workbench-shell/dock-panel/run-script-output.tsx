import type { WorkspaceScriptSummary } from '@/renderer/types/workbench';

import { ReadOnlyCommandOutput } from './read-only-command-output';
import { ScriptEmptyState } from './script-empty-state';

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

	if (script.lines.length === 0) {
		return (
			<ScriptEmptyState
				actionLabel='Run'
				detail='Start the run script to stream dev server output here.'
				onAction={onRunScript}
				title='Run script is stopped'
			/>
		);
	}

	return (
		<ReadOnlyCommandOutput
			lines={script.lines}
			title={script.command ?? 'Run'}
		/>
	);
}
