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
import type { WorkspaceRunTargetSummary } from '@/renderer/types/workbench';
import type { RepositoryPreviewUrl } from '@/shared/ipc/contracts/repository-settings';

import { RunStoppedEmptyState } from './run-stopped-empty-state';
import { ScriptEmptyState } from './script-empty-state';
import { XtermTerminal } from './xterm-terminal';

/** Renders one run target's dock output, or the appropriate empty state (ADR 0041). */
export function RunScriptOutputPanel({
	configuredPreviewUrls,
	onOpenRunPort,
	onOpenSetupScripts,
	onRunScript,
	onStopRunScript,
	target,
	workspaceName,
}: {
	configuredPreviewUrls: readonly RepositoryPreviewUrl[];
	onOpenRunPort: (url: string) => void;
	onOpenSetupScripts: () => void;
	onRunScript: () => void;
	onStopRunScript: () => void;
	target: WorkspaceRunTargetSummary;
	workspaceName: string;
}) {
	if (target.status === 'missing') {
		return (
			<ScriptEmptyState
				actionLabel='Setup Scripts'
				detail='Add a run script for the normal dev server, watcher, worker, or local app command.'
				onAction={onOpenSetupScripts}
				title='No run script configured'
			/>
		);
	}

	if (!target.terminalId) {
		return <RunStoppedEmptyState onRunScript={onRunScript} />;
	}

	const previewOptions = resolvePreviewUrlOptions({
		configured: [...configuredPreviewUrls],
		detectedUrl: target.previewUrl ?? null,
		port: typeof target.port === 'number' ? target.port : null,
		workspaceName,
	});

	return (
		<div className='relative h-full min-h-0'>
			<XtermTerminal
				readOnly
				sessionStatus={target.sessionStatus ?? null}
				terminalId={target.terminalId}
			/>
			<div className='absolute right-3 bottom-3 z-10 flex items-center gap-2'>
				{target.status === 'running' ? (
					<OpenPreviewControl
						onOpen={onOpenRunPort}
						options={previewOptions}
						port={typeof target.port === 'number' ? target.port : null}
					/>
				) : null}
				<Button
					aria-label={
						target.status === 'running' ? 'Stop run script' : 'Run script'
					}
					className='shadow-sm'
					onClick={target.status === 'running' ? onStopRunScript : onRunScript}
					size='sm'
					variant='outline'
				>
					{target.status === 'running' ? (
						<SquareIcon data-icon='inline-start' />
					) : (
						<PlayIcon data-icon='inline-start' />
					)}
					{target.status === 'running' ? 'Stop' : 'Run'}
				</Button>
			</div>
		</div>
	);
}

/**
 * Renders the dock Open control: a single button when one preview URL applies,
 * or a split button with a dropdown of the configured URLs when several do.
 * Renders nothing when no preview URL is configured or auto-detected yet.
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
				className='shadow-sm'
				onClick={() => onOpen(primary.url)}
				size='sm'
				variant='outline'
			>
				<ExternalLinkIcon data-icon='inline-start' />
				{port !== null ? `Open :${port}` : primary.name}
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
		<div className='flex items-center shadow-sm'>
			<Button
				aria-label={`Open ${primary.name}`}
				className='rounded-r-none'
				onClick={() => onOpen(primary.url)}
				size='sm'
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
						size='sm'
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
