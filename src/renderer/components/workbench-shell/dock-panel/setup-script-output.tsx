import { RefreshCwIcon, SquareIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import type { WorkspaceScriptSummary } from '@/renderer/types/workbench';

import { SetupMissingEmptyState } from './setup-missing-empty-state';
import { SetupNotRunEmptyState } from './setup-not-run-empty-state';
import { XtermTerminal } from './xterm-terminal';

/** Props for {@link SetupScriptOutputPanel}. */
interface SetupScriptOutputPanelProps {
	onAskAgentSetupScript: () => void;
	onOpenSetupScripts: () => void;
	onRunSetupScript: () => void;
	onStopSetupScript: () => void;
	script: WorkspaceScriptSummary;
}

/** Renders the Setup script output or the appropriate empty state. */
export function SetupScriptOutputPanel({
	onAskAgentSetupScript,
	onOpenSetupScripts,
	onRunSetupScript,
	onStopSetupScript,
	script,
}: SetupScriptOutputPanelProps) {
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
			<SetupActionButton
				onRerun={onRunSetupScript}
				onStop={onStopSetupScript}
				running={script.status === 'running'}
			/>
		</div>
	);
}

/**
 * Floating bottom-right control over the Setup run. While setup is running it
 * stops the script; once the run has finished it reruns setup. Both setup
 * actions live here because the dock header is reserved for run-script controls.
 */
function SetupActionButton({
	onRerun,
	onStop,
	running,
}: {
	onRerun: () => void;
	onStop: () => void;
	running: boolean;
}) {
	return (
		<Button
			className='absolute right-3 bottom-3 z-10 pr-2 shadow-sm'
			onClick={running ? onStop : onRerun}
			size='sm'
			variant='outline'
		>
			{running ? (
				<SquareIcon data-icon='inline-start' />
			) : (
				<RefreshCwIcon data-icon='inline-start' />
			)}
			{running ? 'Stop setup' : 'Rerun setup'}
		</Button>
	);
}
