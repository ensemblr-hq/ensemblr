import {
	ChevronDownIcon,
	ExternalLinkIcon,
	PlayIcon,
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
 * Below the `md` dock-header container width the buttons collapse to icons to
 * leave room for tabs; the Open control keeps its `:port` label.
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
				<Button
					aria-label='Stop run script'
					onClick={actions.onStopRunScript}
					size='xs'
					variant='outline'
				>
					<SquareIcon data-icon='inline-start' />
					<span className='@max-md/dock-header:hidden'>Stop</span>
				</Button>
			</>
		);
	}

	if (hasRunScript) {
		return (
			<Button
				aria-label='Run script'
				onClick={actions.onRunScript}
				size='xs'
				variant='outline'
			>
				<PlayIcon data-icon='inline-start' />
				<span className='@max-md/dock-header:hidden'>Run</span>
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
 * configured or auto-detected yet. Collapses to an icon at narrow dock-header
 * widths, but always keeps the `:port` label so the port stays visible.
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

	if (options.length === 1) {
		return (
			<Button
				aria-label={
					port !== null
						? `Open preview on port ${port}`
						: `Open ${primary.name}`
				}
				onClick={() => onOpen(primary.url)}
				size='xs'
				variant='outline'
			>
				<ExternalLinkIcon data-icon='inline-start' />
				{port !== null ? (
					<>
						<span className='@max-md/dock-header:hidden'>Open :{port}</span>
						<span className='@max-md/dock-header:inline hidden'>:{port}</span>
					</>
				) : (
					<span className='@max-md/dock-header:hidden'>{primary.name}</span>
				)}
			</Button>
		);
	}

	return (
		<OpenPreviewSplit onOpen={onOpen} options={options} primary={primary} />
	);
}

/** Split Open button: primary opens the first URL, the dropdown lists the rest. */
function OpenPreviewSplit({
	onOpen,
	options,
	primary,
}: {
	onOpen: (url: string) => void;
	options: PreviewUrlOption[];
	primary: PreviewUrlOption;
}) {
	return (
		<div className='flex items-center'>
			<Button
				aria-label={`Open ${primary.name}`}
				className='rounded-r-none'
				onClick={() => onOpen(primary.url)}
				size='xs'
				variant='outline'
			>
				<ExternalLinkIcon data-icon='inline-start' />
				<span className='@max-md/dock-header:hidden'>{primary.name}</span>
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
