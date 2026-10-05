import { useTranslation } from 'react-i18next';

import type { WorkspaceScriptSummary } from '@/renderer/types/workbench';

import { RunStoppedEmptyState } from './run-stopped-empty-state';
import { ScriptEmptyState } from './script-empty-state';
import { ScriptQueuedEmptyState } from './script-queued-empty-state';
import { SecretPromptBar } from './secret-prompt-bar';
import { XtermTerminal } from './xterm-terminal';

/** Props for {@link RunScriptOutputPanel}. */
interface RunScriptOutputPanelProps {
	/** Script the stopped empty state starts, or null when none is configured. */
	activeRunScriptName: string | null;
	/** Whether this pane is the dock's active tab and the dock is expanded. */
	isVisible?: boolean;
	/** Withdraws the queued run launch with this job id. */
	onCancelQueuedScript: (jobId: string) => void;
	onOpenSetupScripts: () => void;
	onRunScript: (scriptName?: string) => void;
	/** Grants the queued run launch with this job id its slot at once. */
	onStartQueuedScript: (jobId: string) => void;
	script: WorkspaceScriptSummary;
	/** The dock tab's own name, which names a selection attached from this pane. */
	tabLabel: string;
	workspaceCwd: string;
}

/**
 * Renders the Run script output or the appropriate empty state. A run launch
 * waiting for a compute slot outranks an earlier run's output, which describes
 * a session the queued launch is about to replace.
 */
export function RunScriptOutputPanel({
	activeRunScriptName,
	isVisible = true,
	onCancelQueuedScript,
	onOpenSetupScripts,
	onRunScript,
	onStartQueuedScript,
	script,
	tabLabel,
	workspaceCwd,
}: RunScriptOutputPanelProps) {
	const { t } = useTranslation();
	const { queuedJob } = script;

	if (queuedJob) {
		return (
			<ScriptQueuedEmptyState
				job={queuedJob}
				onCancel={() => onCancelQueuedScript(queuedJob.id)}
				onStartNow={() => onStartQueuedScript(queuedJob.id)}
			/>
		);
	}

	if (script.status === 'missing') {
		return (
			<ScriptEmptyState
				actionLabel={t(
					'workbench:run-script.configure-action',
					'Setup Scripts',
				)}
				detail={t(
					'workbench:run-script.empty.detail',
					'Add a run script for the normal dev server, watcher, worker, or local app command.',
				)}
				onAction={onOpenSetupScripts}
				title={t(
					'workbench:run-script.empty.title',
					'No run script configured',
				)}
			/>
		);
	}

	if (!script.terminalId) {
		return (
			<RunStoppedEmptyState
				activeRunScriptName={activeRunScriptName}
				onRunScript={onRunScript}
			/>
		);
	}

	return (
		<div className='relative h-full min-h-0'>
			<XtermTerminal
				isVisible={isVisible}
				readOnly
				sessionStatus={script.sessionStatus ?? null}
				terminalId={script.terminalId}
				terminalLabel={tabLabel}
				workspaceCwd={workspaceCwd}
			/>
			{script.secretPrompt ? (
				<SecretPromptBar
					key={`${script.terminalId}:${script.secretPrompt}`}
					prompt={script.secretPrompt}
					terminalId={script.terminalId}
				/>
			) : null}
		</div>
	);
}
