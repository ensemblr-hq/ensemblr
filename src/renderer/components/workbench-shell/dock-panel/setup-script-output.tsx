import type { WorkspaceScriptSummary } from '@/renderer/types/workbench';

import { ReadOnlyCommandOutput } from './read-only-command-output';
import { ScriptEmptyState } from './script-empty-state';

/** Renders the Setup script output or the appropriate empty state. */
export function SetupScriptOutputPanel({
	onOpenSetupScripts,
	onRunSetupScript,
	script,
}: {
	onOpenSetupScripts: () => void;
	onRunSetupScript: () => void;
	script: WorkspaceScriptSummary;
}) {
	if (script.status === 'missing') {
		return (
			<ScriptEmptyState
				actionLabel='Setup Scripts'
				detail='Add a setup script to install dependencies or prepare each workspace before the first agent turn.'
				onAction={onOpenSetupScripts}
				title='No setup script configured'
			/>
		);
	}

	if (script.status === 'not-run') {
		return (
			<ScriptEmptyState
				actionLabel='Run setup script'
				detail='Run the configured setup script before starting the dev server or relying on generated dependencies.'
				onAction={onRunSetupScript}
				title='Setup script has not run'
			/>
		);
	}

	return (
		<ReadOnlyCommandOutput
			lines={script.lines}
			title={script.command ?? 'Setup'}
		/>
	);
}
