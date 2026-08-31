import { useAtomValue } from 'jotai';
import {
	ChevronDownIcon,
	ChevronUpIcon,
	Loader2Icon,
	PlayIcon,
	PlusIcon,
	SquareTerminalIcon,
	WrenchIcon,
	XIcon,
} from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { TabScroller } from '@/renderer/components/ui/tab-scroller';
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from '@/renderer/components/ui/tabs';
import { useWorkbenchLayout } from '@/renderer/components/workbench-shell/shell-contexts';
import { useRunScriptHotkey } from '@/renderer/hooks/workbench-shell/dock-panel/use-run-script-hotkey';
import { useDockMenuCommands } from '@/renderer/hooks/workbench-shell/use-dock-menu-commands';
import { selectActiveRunScript } from '@/renderer/lib/terminal';
import { cn } from '@/renderer/lib/utils';
import { DEFAULT_DOCK_TAB } from '@/renderer/lib/workbench';
import { lastRunScriptAtomFamily } from '@/renderer/state/preferences';
import type {
	DockTabId,
	DockTabModel,
	TerminalDockTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';

import { DockPanelActions } from './actions';
import { RunScriptOutputPanel } from './run-script-output';
import { SetupScriptOutputPanel } from './setup-script-output';
import { XtermTerminal } from './xterm-terminal';

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
	const { t } = useTranslation();
	const { state, actions: layoutActions } = useWorkbenchLayout();
	const isCollapsed = state.isDockCollapsed;
	const DockToggleIcon = isCollapsed ? ChevronUpIcon : ChevronDownIcon;
	const activeDockTab = workspace.dockTabs.some((tab) => tab.id === activeTab)
		? activeTab
		: DEFAULT_DOCK_TAB;
	const terminalTabs = workspace.dockTabs.filter(isTerminalDockTab);
	const setupTabLabel = fixedDockTabLabel(workspace.dockTabs, 'setup');
	const runTabLabel = fixedDockTabLabel(workspace.dockTabs, 'run');
	const rememberedRunScript = useAtomValue(
		lastRunScriptAtomFamily(workspace.id),
	);
	const activeRunScript = selectActiveRunScript({
		rememberedName: rememberedRunScript,
		runScripts: workspace.runScripts,
		runSummary: workspace.scripts.run,
	});

	useRunScriptHotkey(workspace.scripts.run.status, actions, activeRunScript);
	useDockMenuCommands(
		workspace.scripts.run.status,
		actions,
		activeRunScript,
		workspace.runScripts,
	);

	return (
		<Tabs
			className='h-full min-h-0 gap-0 overflow-hidden'
			onValueChange={(value) => onTabChange(value as DockTabId)}
			value={activeDockTab}
		>
			{/*
			  Separator drawn as an inset shadow instead of border-b: borders render
			  below the content box, so the active tab's underline could never cover
			  them and a 1px gap stayed visible. The shadow occupies the bottom
			  content pixel, which the underline paints over.
			*/}
			<div className='@container/dock-header flex h-9 shrink-0 items-center justify-between gap-2 overflow-hidden px-2 shadow-bottom-rule'>
				<Button
					aria-label={
						isCollapsed
							? t('workbench:dock-panel.expand', 'Expand terminal area')
							: t('workbench:dock-panel.collapse', 'Collapse terminal area')
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
				<TabScroller activeKey={activeDockTab} className='h-full flex-1'>
					<TabsList
						className='h-full w-max min-w-full items-center justify-start gap-1 rounded-none bg-transparent p-0 group-data-horizontal/tabs:h-full'
						variant='line'
					>
						{workspace.dockTabs.map((tab) => {
							// Setup/Run are fixed; every terminal tab is closable (down to
							// zero — the dock falls back to Setup and the `+` button remains).
							const closableTerminalId = isTerminalDockTab(tab)
								? tab.terminalId
								: null;

							return (
								<Fragment key={tab.id}>
									<div
										className='group/dock-tab relative flex h-full flex-none items-center overflow-hidden'
										data-tab-key={tab.id}
									>
										<TabsTrigger
											className={cn(
												// Chat-tab-style active indicator: full row height so the
												// primary underline sits flush on the header's bottom border
												// (the default line-variant indicator renders below the list
												// and gets clipped here).
												'h-full flex-none rounded-none px-2 text-xs after:bg-primary group-data-horizontal/tabs:after:bottom-0 [&_svg]:size-3.5',
											)}
											data-dock-tab-kind={tab.kind}
											value={tab.id}
										>
											<DockTabGlyph tab={tab} />
											{tab.label}
										</TabsTrigger>
										{closableTerminalId ? <DockTabCloseOverlay /> : null}
										{closableTerminalId ? (
											<DockTabCloseButton
												label={tab.label}
												onCloseTerminal={actions.onCloseTerminal}
												terminalId={closableTerminalId}
											/>
										) : null}
									</div>
								</Fragment>
							);
						})}
					</TabsList>
				</TabScroller>
				<Button
					className='size-6 shrink-0 text-muted-foreground hover:text-foreground'
					onClick={actions.onNewTerminal}
					size='icon-xs'
					type='button'
					variant='ghost'
				>
					<PlusIcon aria-hidden='true' />
					<span className='sr-only'>
						{t('workbench:dock-panel.new-terminal', 'New terminal')}
					</span>
				</Button>
				<div className='flex shrink-0 items-center gap-1'>
					<DockPanelActions
						actions={actions}
						activeRunScript={activeRunScript}
						workspace={workspace}
					/>
				</div>
			</div>
			{/*
			  Dock panels stay mounted across tab switches (forceMount + hidden):
			  xterm instances are expensive to recreate and must keep their
			  scrollback/PTY binding alive while another tab is visible.
			*/}
			<TabsContent
				className='min-h-0 overflow-hidden data-[state=inactive]:hidden'
				forceMount
				value='setup'
			>
				<SetupScriptOutputPanel
					onAskAgentSetupScript={actions.onAskAgentSetupScript}
					onOpenSetupScripts={actions.onOpenSetupScripts}
					onRunSetupScript={actions.onRunSetupScript}
					onStopSetupScript={actions.onStopSetupScript}
					script={workspace.scripts.setup}
					tabLabel={setupTabLabel}
					workspaceCwd={workspace.pathLabel}
				/>
			</TabsContent>
			<TabsContent
				className='min-h-0 overflow-hidden data-[state=inactive]:hidden'
				forceMount
				value='run'
			>
				<RunScriptOutputPanel
					activeRunScriptName={activeRunScript?.name ?? null}
					onOpenSetupScripts={actions.onOpenSetupScripts}
					onRunScript={actions.onRunScript}
					script={workspace.scripts.run}
					tabLabel={runTabLabel}
					workspaceCwd={workspace.pathLabel}
				/>
			</TabsContent>
			{terminalTabs.map((tab) => (
				<TabsContent
					className='min-h-0 overflow-hidden data-[state=inactive]:hidden'
					forceMount
					key={tab.id}
					value={tab.id}
				>
					<XtermTerminal
						sessionStatus={tab.sessionStatus}
						terminalId={tab.terminalId}
						terminalLabel={tab.label}
						workspaceCwd={workspace.pathLabel}
					/>
				</TabsContent>
			))}
		</Tabs>
	);
}

/** Gradient veil that lets the close button overlay terminal tab text on hover. */
function DockTabCloseOverlay() {
	return (
		<span
			aria-hidden='true'
			className='pointer-events-none absolute top-0 right-0 bottom-0.5 w-10 bg-linear-to-l from-card via-card/90 to-transparent opacity-0 transition-opacity group-focus-within/dock-tab:opacity-100 group-hover/dock-tab:opacity-100'
		/>
	);
}

/** Hover-revealed close affordance for closable terminal tabs. */
function DockTabCloseButton({
	label,
	onCloseTerminal,
	terminalId,
}: {
	label: string;
	onCloseTerminal: (terminalId: string) => void;
	terminalId: string;
}) {
	const { t } = useTranslation();

	return (
		<button
			aria-label={t('workbench:dock-panel.close-tab', 'Close {{label}} tab', {
				label,
			})}
			className='pointer-events-none absolute top-1/2 right-1 grid size-4 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground opacity-0 transition hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-focus-within/dock-tab:pointer-events-auto group-focus-within/dock-tab:opacity-100 group-hover/dock-tab:pointer-events-auto group-hover/dock-tab:opacity-100'
			onClick={(event) => {
				event.stopPropagation();
				onCloseTerminal(terminalId);
			}}
			onPointerDown={(event) => event.stopPropagation()}
			type='button'
		>
			<XIcon aria-hidden='true' className='size-3' />
		</button>
	);
}

/** Renders the dock tab icon, swapping to a spinner while work is running. */
function DockTabGlyph({ tab }: { tab: DockTabModel }) {
	if (tab.status === 'running') {
		return <Loader2Icon aria-hidden='true' className='size-3.5 animate-spin' />;
	}

	const DockTabIcon = getDockTabIcon(tab);

	return <DockTabIcon aria-hidden='true' />;
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

/**
 * The name one of the two fixed dock tabs wears, which is what a selection
 * attached from its pane is filed under. Empty when the tab is missing, which
 * the chip falls back on rather than rendering a blank.
 * @param tabs - The workspace's dock tabs
 * @param id - Which fixed tab to name
 * @returns The tab's label, or an empty string
 */
function fixedDockTabLabel(
	tabs: readonly DockTabModel[],
	id: 'run' | 'setup',
): string {
	return tabs.find((tab) => tab.id === id)?.label ?? '';
}

/** Type guard for terminal-kind dock tabs. */
function isTerminalDockTab(tab: DockTabModel): tab is TerminalDockTabModel {
	return tab.kind === 'terminal';
}
