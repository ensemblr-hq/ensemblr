import {
	ChevronDownIcon,
	ExternalLinkIcon,
	PlayIcon,
	RocketIcon,
	SquareIcon,
} from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import {
	type PreviewUrlOption,
	resolvePreviewUrlOptions,
} from '@/renderer/lib/workbench/preview-urls';
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
		const previewOptions = resolvePreviewUrlOptions({
			configured: workspace.configuredPreviewUrls ?? [],
			detectedUrl: run.previewUrl ?? null,
			port: typeof run.port === 'number' ? run.port : null,
			workspaceName: workspace.name,
		});

		return (
			<>
				<OpenPreviewControl
					onOpen={actions.onOpenRunPort}
					options={previewOptions}
					port={typeof run.port === 'number' ? run.port : null}
				/>
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

/**
 * Renders the dock Open control: a single button when one preview URL applies,
 * or a split button with a dropdown of the configured URLs when several do. The
 * first option is the default action. Renders nothing when no preview URL is
 * configured or auto-detected yet.
 */
function OpenPreviewControl({
	onOpen,
	options,
	port,
}: {
	onOpen: (url: string) => void;
	options: PreviewUrlOption[];
	port: number | null;
}) {
	const primary = options[0];

	if (!primary) {
		return null;
	}

	const primaryLabel =
		options.length === 1 && port !== null ? `Open :${port}` : primary.name;

	if (options.length === 1) {
		return (
			<Button onClick={() => onOpen(primary.url)} size='xs' variant='outline'>
				<ExternalLinkIcon data-icon='inline-start' />
				{primaryLabel}
			</Button>
		);
	}

	return (
		<div className='flex items-center'>
			<Button
				className='rounded-r-none'
				onClick={() => onOpen(primary.url)}
				size='xs'
				variant='outline'
			>
				<ExternalLinkIcon data-icon='inline-start' />
				{primary.name}
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						aria-label='Choose preview URL'
						className='rounded-l-none border-l-0 px-1'
						size='xs'
						variant='outline'
					>
						<ChevronDownIcon className='size-3' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end'>
					{options.map((option) => (
						<DropdownMenuItem
							key={`${option.name}:${option.url}`}
							onSelect={() => onOpen(option.url)}
						>
							{option.name}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
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
