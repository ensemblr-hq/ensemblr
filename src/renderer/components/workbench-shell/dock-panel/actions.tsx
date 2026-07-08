import {
	ExternalLinkIcon,
	PlayIcon,
	SquareIcon,
	WrenchIcon,
} from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';

/** Renders the appropriate setup/run/stop button cluster on the dock header. */
export function DockPanelActions({
	actions,
	workspace,
}: {
	actions: WorkbenchDockActions;
	workspace: WorkspaceShellModel;
}) {
	const { run, setup } = workspace.scripts;
	const hasSetupScript = setup.status !== 'missing';
	const hasRunScript = run.status !== 'missing';

	if (!(hasSetupScript || hasRunScript)) {
		return (
			<Button onClick={actions.onOpenSetupScripts} size='xs' variant='outline'>
				<WrenchIcon data-icon='inline-start' />
				Setup Scripts
			</Button>
		);
	}

	if (hasSetupScript && setup.status === 'not-run') {
		return (
			<Button onClick={actions.onRunSetupScript} size='xs' variant='outline'>
				<WrenchIcon data-icon='inline-start' />
				Run setup script
			</Button>
		);
	}

	if (hasSetupScript && setup.status === 'running') {
		return (
			<Button onClick={actions.onStopSetupScript} size='xs' variant='outline'>
				<SquareIcon data-icon='inline-start' />
				Stop setup script
			</Button>
		);
	}

	if (hasRunScript && run.status === 'running') {
		const previewUrl = run.previewUrl;

		return (
			<>
				{previewUrl ? (
					<Button
						onClick={() => actions.onOpenRunPort(previewUrl)}
						size='xs'
						variant='outline'
					>
						<ExternalLinkIcon data-icon='inline-start' />
						{typeof run.port === 'number' ? `Open :${run.port}` : 'Open'}
					</Button>
				) : null}
				<Button onClick={actions.onStopRunScript} size='xs' variant='outline'>
					<SquareIcon data-icon='inline-start' />
					Stop
				</Button>
			</>
		);
	}

	if (hasRunScript) {
		return (
			<Button onClick={actions.onRunScript} size='xs' variant='outline'>
				<PlayIcon data-icon='inline-start' />
				Run
			</Button>
		);
	}

	return (
		<Button onClick={actions.onOpenSetupScripts} size='xs' variant='outline'>
			<WrenchIcon data-icon='inline-start' />
			Setup Scripts
		</Button>
	);
}
