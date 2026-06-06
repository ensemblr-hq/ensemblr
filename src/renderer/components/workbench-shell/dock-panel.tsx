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

import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from '@/renderer/components/ui/tabs';
import { DEFAULT_DOCK_TAB } from '@/renderer/lib/workbench';
import type {
	DockTabId,
	DockTabModel,
	TerminalDockTabModel,
	WorkspaceScriptSummary,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';

// Setup and Run are fixed, read-only script output panes. Terminal tabs are
// independent interactive sessions: every user-spawned terminal needs its own
// `terminal:*` tab id and persisted terminal session id.
export function DockPanel({
	actions,
	activeTab,
	isCollapsed,
	onTabChange,
	onToggleCollapsed,
	workspace,
}: {
	actions: WorkbenchDockActions;
	activeTab: DockTabId;
	isCollapsed: boolean;
	onTabChange: (tab: DockTabId) => void;
	onToggleCollapsed: () => void;
	workspace: WorkspaceShellModel;
}) {
	const DockToggleIcon = isCollapsed ? ChevronUpIcon : ChevronDownIcon;
	const activeDockTab = workspace.dockTabs.some((tab) => tab.id === activeTab)
		? activeTab
		: DEFAULT_DOCK_TAB;
	const terminalTabs = workspace.dockTabs.filter(isTerminalDockTab);
	const lastTerminalTabId = terminalTabs.at(-1)?.id;

	return (
		<Tabs
			className='h-full min-h-0 gap-0 overflow-hidden'
			onValueChange={(value) => onTabChange(value as DockTabId)}
			value={activeDockTab}
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
							const DockTabIcon = getDockTabIcon(tab);

							return (
								<Fragment key={tab.id}>
									<TabsTrigger
										className='h-7 flex-none px-2 text-xs [&_svg]:size-3.5'
										data-dock-tab-kind={tab.kind}
										value={tab.id}
									>
										<DockTabIcon aria-hidden='true' />
										{tab.label}
									</TabsTrigger>
									{tab.id === lastTerminalTabId ? (
										<Button
											className='size-6 flex-none text-muted-foreground hover:text-foreground'
											key='new-terminal'
											onClick={actions.onNewTerminal}
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
					<DockPanelActions actions={actions} workspace={workspace} />
				</div>
			</div>
			<TabsContent className='min-h-0 overflow-hidden' value='setup'>
				<SetupScriptOutputPanel
					onOpenSetupScripts={actions.onOpenSetupScripts}
					onRunSetupScript={actions.onRunSetupScript}
					script={workspace.scripts.setup}
				/>
			</TabsContent>
			<TabsContent className='min-h-0 overflow-hidden' value='run'>
				<RunScriptOutputPanel
					onOpenSetupScripts={actions.onOpenSetupScripts}
					onRunScript={actions.onRunScript}
					script={workspace.scripts.run}
				/>
			</TabsContent>
			{terminalTabs.map((tab) => (
				<TabsContent
					className='min-h-0 overflow-hidden'
					key={tab.id}
					value={tab.id}
				>
					<InteractiveTerminalPanel tab={tab} />
				</TabsContent>
			))}
		</Tabs>
	);
}

function DockPanelActions({
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

	if (hasRunScript && run.status === 'running') {
		return (
			<>
				{typeof run.port === 'number' ? (
					<Button
						onClick={() => actions.onOpenRunPort(run.port as number)}
						size='xs'
						variant='outline'
					>
						<ExternalLinkIcon data-icon='inline-start' />
						Open :{run.port}
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

function SetupScriptOutputPanel({
	onOpenSetupScripts,
	onRunSetupScript,
	script,
}: {
	onOpenSetupScripts: () => void;
	onRunSetupScript: () => void;
	script: WorkspaceScriptSummary;
}) {
	if (script.status === 'missing') {
		return (
			<ScriptEmptyState
				actionLabel='Setup Scripts'
				detail='Add a setup script to install dependencies or prepare each workspace before the first agent turn.'
				onAction={onOpenSetupScripts}
				title='No setup script configured'
			/>
		);
	}

	if (script.status === 'not-run') {
		return (
			<ScriptEmptyState
				actionLabel='Run setup script'
				detail='Run the configured setup script before starting the dev server or relying on generated dependencies.'
				onAction={onRunSetupScript}
				title='Setup script has not run'
			/>
		);
	}

	return (
		<ReadOnlyCommandOutput
			lines={script.lines}
			title={script.command ?? 'Setup'}
		/>
	);
}

function RunScriptOutputPanel({
	onOpenSetupScripts,
	onRunScript,
	script,
}: {
	onOpenSetupScripts: () => void;
	onRunScript: () => void;
	script: WorkspaceScriptSummary;
}) {
	if (script.status === 'missing') {
		return (
			<ScriptEmptyState
				actionLabel='Setup Scripts'
				detail='Add a run script for the normal dev server, watcher, worker, or local app command.'
				onAction={onOpenSetupScripts}
				title='No run script configured'
			/>
		);
	}

	if (script.lines.length === 0) {
		return (
			<ScriptEmptyState
				actionLabel='Run'
				detail='Start the run script to stream dev server output here.'
				onAction={onRunScript}
				title='Run script is stopped'
			/>
		);
	}

	return (
		<ReadOnlyCommandOutput
			lines={script.lines}
			title={script.command ?? 'Run'}
		/>
	);
}

function ScriptEmptyState({
	actionLabel,
	detail,
	onAction,
	title,
}: {
	actionLabel: string;
	detail: string;
	onAction: () => void;
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
				<Button className='mt-1' onClick={onAction} size='xs' variant='outline'>
					{actionLabel}
				</Button>
			</div>
		</div>
	);
}

function InteractiveTerminalPanel({ tab }: { tab: TerminalDockTabModel }) {
	return (
		<LogDockContent
			lines={tab.lines}
			sessionId={tab.sessionId}
			title={tab.label}
		/>
	);
}

function ReadOnlyCommandOutput({
	lines,
	title,
}: {
	lines: string[];
	title: string;
}) {
	return <LogDockContent isReadOnly lines={lines} title={title} />;
}

function LogDockContent({
	isReadOnly = false,
	lines,
	sessionId,
	title,
}: {
	isReadOnly?: boolean;
	lines: string[];
	sessionId?: string;
	title: string;
}) {
	return (
		<ScrollArea
			className='h-full bg-terminal text-terminal-foreground'
			data-terminal-session-id={sessionId}
			data-terminal-surface={
				isReadOnly ? 'readonly-script-output' : 'interactive'
			}
		>
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

function getDockTabIcon(tab: DockTabModel) {
	switch (tab.kind) {
		case 'run-script':
			return PlayIcon;
		case 'setup-script':
			return WrenchIcon;
		case 'terminal':
			return SquareTerminalIcon;
	}
}

function isTerminalDockTab(tab: DockTabModel): tab is TerminalDockTabModel {
	return tab.kind === 'terminal';
}
