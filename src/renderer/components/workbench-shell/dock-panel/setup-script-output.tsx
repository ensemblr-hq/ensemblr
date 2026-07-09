import { RefreshCwIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
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
		<div className='relative h-full min-h-0'>
			<XtermTerminal
				readOnly
				sessionStatus={script.sessionStatus ?? null}
				terminalId={script.terminalId}
			/>
			{script.status === 'running' ? null : (
				<SetupRerunButton onRerun={onRunSetupScript} />
			)}
		</div>
	);
}

/**
 * Floating bottom-right control over a finished Setup run that reruns the setup
 * script. Hidden while the script is running — the dock header owns the stop
 * control in that state, so surfacing it here too would duplicate that action.
 */
function SetupRerunButton({ onRerun }: { onRerun: () => void }) {
	return (
		<Button
			className='absolute right-3 bottom-3 z-10 pr-2 shadow-sm'
			onClick={onRerun}
			size='sm'
			variant='outline'
		>
			<RefreshCwIcon data-icon='inline-start' />
			Rerun setup
		</Button>
	);
}
