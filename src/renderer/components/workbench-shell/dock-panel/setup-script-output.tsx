import type { WorkspaceScriptSummary } from '@/renderer/types/workbench';

import { SetupMissingEmptyState } from './setup-missing-empty-state';
import { SetupNotRunEmptyState } from './setup-not-run-empty-state';
import { XtermTerminal } from './xterm-terminal';

/** Renders the Setup script output or the appropriate empty state. */
export function SetupScriptOutputPanel({
	onAskAgentSetupScript,
	onOpenSetupScripts,
	onRunSetupScript,
	script,
}: {
	onAskAgentSetupScript: () => void;
	onOpenSetupScripts: () => void;
	onRunSetupScript: () => void;
	script: WorkspaceScriptSummary;
}) {
	if (script.status === 'missing') {
		return (
			<SetupMissingEmptyState
				onAddManually={onOpenSetupScripts}
				onAskAgent={onAskAgentSetupScript}
			/>
		);
	}

	if (script.status === 'not-run' || !script.terminalId) {
		return <SetupNotRunEmptyState onRunSetupScript={onRunSetupScript} />;
	}

	return (
		<XtermTerminal
			readOnly
			sessionStatus={script.sessionStatus ?? null}
			terminalId={script.terminalId}
		/>
	);
}
