import {
	ChevronDownIcon,
	ChevronUpIcon,
	PlayIcon,
	PlusIcon,
	SquareTerminalIcon,
	WrenchIcon,
} from 'lucide-react';
import { Fragment } from 'react';

import { Button } from '@/renderer/components/ui/button';
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from '@/renderer/components/ui/tabs';
import { useWorkbenchLayout } from '@/renderer/components/workbench-shell/contexts';
import { DEFAULT_DOCK_TAB } from '@/renderer/lib/workbench';
import type {
	DockTabId,
	DockTabModel,
	TerminalDockTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';

import { DockPanelActions } from './actions';
import { InteractiveTerminalPanel } from './interactive-terminal';
import { RunScriptOutputPanel } from './run-script-output';
import { SetupScriptOutputPanel } from './setup-script-output';

/**
 * Bottom dock panel hosting fixed Setup/Run output tabs plus user-spawned
 * terminal tabs. Setup and Run are read-only script outputs; terminal tabs are
 * independent interactive sessions keyed by `terminal:*` ids.
 */
export function DockPanel({
	actions,
	activeTab,
	onTabChange,
	workspace,
}: {
	actions: WorkbenchDockActions;
	activeTab: DockTabId;
	onTabChange: (tab: DockTabId) => void;
	workspace: WorkspaceShellModel;
}) {
	const { state, actions: layoutActions } = useWorkbenchLayout();
	const isCollapsed = state.isDockCollapsed;
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
						layoutActions.toggleDockPanel();
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

/** Maps a dock tab kind to its lucide icon component. */
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

/** Type guard for terminal-kind dock tabs. */
function isTerminalDockTab(tab: DockTabModel): tab is TerminalDockTabModel {
	return tab.kind === 'terminal';
}
