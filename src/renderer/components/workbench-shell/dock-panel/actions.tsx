import {
	ExternalLinkIcon,
	PlayIcon,
	RocketIcon,
	SquareIcon,
} from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';

/**
 * Renders the run-script button cluster on the dock header. Setup controls live
 * in the Setup dock tab, not here — the tab row is reserved for run actions.
 */
export function DockPanelActions({
	actions,
	workspace,
}: {
	actions: WorkbenchDockActions;
	workspace: WorkspaceShellModel;
}) {
	const { run } = workspace.scripts;
	const hasRunScript = run.status !== 'missing';
	const desktopRuntime = workspace.desktopRuntime ?? null;

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
				{/* Launch only appears while running — there's no window to focus
				    until the run script has started the desktop app. */}
				{desktopRuntime ? (
					<LaunchDesktopButton onLaunch={actions.onLaunchDesktopApp} />
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

	// Nothing runnable in this state: the tab row carries only run/stop and open
	// actions. The Setup Scripts entry point lives in the Setup dock tab and its
	// settings page, not the header.
	return null;
}

/** Focuses (or reopens) the workspace's detected desktop app window. */
function LaunchDesktopButton({ onLaunch }: { onLaunch: () => void }) {
	return (
		<Button onClick={onLaunch} size='xs' variant='outline'>
			<RocketIcon data-icon='inline-start' />
			Launch
		</Button>
	);
}
