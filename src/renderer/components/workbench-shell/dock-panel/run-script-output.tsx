import { useTranslation } from 'react-i18next';

import type { WorkspaceScriptSummary } from '@/renderer/types/workbench';

import { RunStoppedEmptyState } from './run-stopped-empty-state';
import { ScriptEmptyState } from './script-empty-state';
import { XtermTerminal } from './xterm-terminal';

/** Renders the Run script output or the appropriate empty state. */
export function RunScriptOutputPanel({
	activeRunScriptName,
	onOpenSetupScripts,
	onRunScript,
	script,
	tabLabel,
	workspaceCwd,
}: {
	/** Script the stopped empty state starts, or null when none is configured. */
	activeRunScriptName: string | null;
	onOpenSetupScripts: () => void;
	onRunScript: (scriptName?: string) => void;
	script: WorkspaceScriptSummary;
	/** The dock tab's own name, which names a selection attached from this pane. */
	tabLabel: string;
	workspaceCwd: string;
}) {
	const { t } = useTranslation();

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
		<XtermTerminal
			readOnly
			sessionStatus={script.sessionStatus ?? null}
			terminalId={script.terminalId}
			terminalLabel={tabLabel}
			workspaceCwd={workspaceCwd}
		/>
	);
}
