import {
	ChevronDownIcon,
	ChevronUpIcon,
	ExternalLinkIcon,
	PlayIcon,
	PlusIcon,
	SquareIcon,
	SquareTerminalIcon,
	WrenchIcon,
} from 'lucide-react';
import { Fragment } from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
	DockTabId,
	WorkspaceScriptSummary,
	WorkspaceShellModel,
} from '@/renderer/workbench/workbench-model';

export function DockPanel({
	activeTab,
	isCollapsed,
	onTabChange,
	onToggleCollapsed,
	workspace,
}: {
	activeTab: DockTabId;
	isCollapsed: boolean;
	onTabChange: (tab: DockTabId) => void;
	onToggleCollapsed: () => void;
	workspace: WorkspaceShellModel;
}) {
	const DockToggleIcon = isCollapsed ? ChevronUpIcon : ChevronDownIcon;

	return (
		<Tabs
			className='h-full min-h-0 gap-0 overflow-hidden'
			onValueChange={(value) => onTabChange(value as DockTabId)}
			value={activeTab}
		>
			<div className='flex h-9 shrink-0 items-center justify-between gap-2 overflow-hidden border-border border-b px-2'>
				<Button
					aria-label={
						isCollapsed ? 'Expand terminal area' : 'Collapse terminal area'
					}
					className='size-6 shrink-0 text-muted-foreground hover:text-foreground'
					onClick={(event) => {
						event.stopPropagation();
						onToggleCollapsed();
					}}
					size='icon-xs'
					type='button'
					variant='ghost'
				>
					<DockToggleIcon aria-hidden='true' />
				</Button>
				<div className='no-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden'>
					<TabsList
						className='h-7 w-max min-w-full justify-start gap-1 rounded-none bg-transparent p-0'
						variant='line'
					>
						{workspace.dockTabs.map((tab) => {
							const DockTabIcon =
								tab.id === 'terminal'
									? SquareTerminalIcon
									: tab.id === 'run'
										? PlayIcon
										: WrenchIcon;

							return (
								<Fragment key={tab.id}>
									<TabsTrigger
										className='h-7 flex-none px-2 text-xs [&_svg]:size-3.5'
										value={tab.id}
									>
										<DockTabIcon aria-hidden='true' />
										{tab.label}
									</TabsTrigger>
									{tab.id === 'terminal' ? (
										<Button
											className='size-6 flex-none text-muted-foreground hover:text-foreground'
											key='new-terminal'
											size='icon-xs'
											type='button'
											variant='ghost'
										>
											<PlusIcon aria-hidden='true' />
											<span className='sr-only'>New terminal</span>
										</Button>
									) : null}
								</Fragment>
							);
						})}
					</TabsList>
				</div>
				<div className='flex shrink-0 items-center gap-1'>
					<DockPanelActions workspace={workspace} />
				</div>
			</div>
			<TabsContent className='min-h-0 overflow-hidden' value='setup'>
				<SetupDockContent script={workspace.scripts.setup} />
			</TabsContent>
			<TabsContent className='min-h-0 overflow-hidden' value='run'>
				<RunDockContent script={workspace.scripts.run} />
			</TabsContent>
			<TabsContent className='min-h-0 overflow-hidden' value='terminal'>
				<LogDockContent
					lines={[
						'$ zsh',
						'Interactive PTY rendering is intentionally deferred to PID-037.',
						'This placeholder preserves the terminal tab contract.',
					]}
					title='Terminal'
				/>
			</TabsContent>
		</Tabs>
	);
}

function DockPanelActions({ workspace }: { workspace: WorkspaceShellModel }) {
	const { run, setup } = workspace.scripts;
	const hasSetupScript = setup.status !== 'missing';
	const hasRunScript = run.status !== 'missing';

	if (!(hasSetupScript || hasRunScript)) {
		return (
			<Button size='xs' variant='outline'>
				<WrenchIcon data-icon='inline-start' />
				Setup Scripts
			</Button>
		);
	}

	if (hasSetupScript && setup.status === 'not-run') {
		return (
			<Button size='xs' variant='outline'>
				<WrenchIcon data-icon='inline-start' />
				Run setup script
			</Button>
		);
	}

	if (hasRunScript && run.status === 'running') {
		return (
			<>
				{typeof run.port === 'number' ? (
					<Button size='xs' variant='outline'>
						<ExternalLinkIcon data-icon='inline-start' />
						Open :{run.port}
					</Button>
				) : null}
				<Button size='xs' variant='outline'>
					<SquareIcon data-icon='inline-start' />
					Stop
				</Button>
			</>
		);
	}

	if (hasRunScript) {
		return (
			<Button size='xs' variant='outline'>
				<PlayIcon data-icon='inline-start' />
				Run
			</Button>
		);
	}

	return (
		<Button size='xs' variant='outline'>
			<WrenchIcon data-icon='inline-start' />
			Setup Scripts
		</Button>
	);
}

function SetupDockContent({ script }: { script: WorkspaceScriptSummary }) {
	if (script.status === 'missing') {
		return (
			<ScriptEmptyState
				actionLabel='Setup Scripts'
				detail='Add a setup script to install dependencies or prepare each workspace before the first agent turn.'
				title='No setup script configured'
			/>
		);
	}

	if (script.status === 'not-run') {
		return (
			<ScriptEmptyState
				actionLabel='Run setup script'
				detail='Run the configured setup script before starting the dev server or relying on generated dependencies.'
				title='Setup script has not run'
			/>
		);
	}

	return (
		<LogDockContent lines={script.lines} title={script.command ?? 'Setup'} />
	);
}

function RunDockContent({ script }: { script: WorkspaceScriptSummary }) {
	if (script.status === 'missing') {
		return (
			<ScriptEmptyState
				actionLabel='Setup Scripts'
				detail='Add a run script for the normal dev server, watcher, worker, or local app command.'
				title='No run script configured'
			/>
		);
	}

	if (script.lines.length === 0) {
		return (
			<ScriptEmptyState
				actionLabel='Run'
				detail='Start the run script to stream dev server output here.'
				title='Run script is stopped'
			/>
		);
	}

	return (
		<LogDockContent lines={script.lines} title={script.command ?? 'Run'} />
	);
}

function ScriptEmptyState({
	actionLabel,
	detail,
	title,
}: {
	actionLabel: string;
	detail: string;
	title: string;
}) {
	return (
		<div className='flex h-full items-center justify-center bg-terminal p-4 text-terminal-foreground'>
			<div className='flex max-w-72 flex-col items-center gap-2 text-center'>
				<div className='grid size-8 place-items-center rounded-md border border-terminal-border bg-terminal-muted/10'>
					<SquareTerminalIcon aria-hidden='true' className='size-4' />
				</div>
				<div className='font-medium text-xs'>{title}</div>
				<p className='text-terminal-muted text-xs leading-5'>{detail}</p>
				<Button className='mt-1' size='xs' variant='outline'>
					{actionLabel}
				</Button>
			</div>
		</div>
	);
}

function LogDockContent({ lines, title }: { lines: string[]; title: string }) {
	return (
		<ScrollArea className='h-full bg-terminal text-terminal-foreground'>
			<div className='flex flex-col gap-1.5 p-3 font-mono text-xs leading-5'>
				<div className='mb-1 flex items-center gap-2 text-terminal-muted'>
					<SquareTerminalIcon aria-hidden='true' className='size-3.5' />
					<span>{title}</span>
				</div>
				{lines.map((line, index) => (
					<div className='flex gap-3' key={`${line}-${index}`}>
						<span className='select-none text-terminal-muted'>
							{String(index + 1).padStart(2, '0')}
						</span>
						<code>{line}</code>
					</div>
				))}
			</div>
		</ScrollArea>
	);
}
