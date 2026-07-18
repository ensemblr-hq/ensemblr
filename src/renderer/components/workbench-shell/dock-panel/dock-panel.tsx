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
import { Fragment, useEffect, useRef } from 'react';

import { Button } from '@/renderer/components/ui/button';
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from '@/renderer/components/ui/tabs';
import { useWorkbenchLayout } from '@/renderer/components/workbench-shell/shell-contexts';
import { useRunScriptHotkey } from '@/renderer/hooks/workbench-shell/dock-panel/use-run-script-hotkey';
import { cn } from '@/renderer/lib/utils';
import { DEFAULT_DOCK_TAB } from '@/renderer/lib/workbench';
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
	const { state, actions: layoutActions } = useWorkbenchLayout();
	const isCollapsed = state.isDockCollapsed;
	const DockToggleIcon = isCollapsed ? ChevronUpIcon : ChevronDownIcon;
	const activeDockTab = workspace.dockTabs.some((tab) => tab.id === activeTab)
		? activeTab
		: DEFAULT_DOCK_TAB;
	const terminalTabs = workspace.dockTabs.filter(isTerminalDockTab);
	const tabStripRef = useRef<HTMLDivElement | null>(null);
	const lastTerminalTabId = terminalTabs.at(-1)?.id;

	useEffect(() => {
		const strip = tabStripRef.current;

		// Newly created terminals land as the rightmost tab and become active;
		// scroll the strip fully right so the new tab (and the "+" button) show.
		if (strip && activeDockTab === lastTerminalTabId) {
			strip.scrollLeft = strip.scrollWidth;
		}
	}, [activeDockTab, lastTerminalTabId]);

	useRunScriptHotkey(workspace.scripts.run.status, actions);

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
			<div className='flex h-9 shrink-0 items-center justify-between gap-2 overflow-hidden px-2 shadow-[inset_0_-0.0625rem_0_0_var(--color-border)]'>
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
				<div
					className='no-scrollbar h-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden'
					ref={tabStripRef}
				>
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
									<div className='group/dock-tab relative flex h-full flex-none items-center overflow-hidden'>
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
				</div>
				<Button
					className='size-6 shrink-0 text-muted-foreground hover:text-foreground'
					onClick={actions.onNewTerminal}
					size='icon-xs'
					type='button'
					variant='ghost'
				>
					<PlusIcon aria-hidden='true' />
					<span className='sr-only'>New terminal</span>
				</Button>
				<div className='flex shrink-0 items-center gap-1'>
					<DockPanelActions actions={actions} workspace={workspace} />
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
				/>
			</TabsContent>
			<TabsContent
				className='min-h-0 overflow-hidden data-[state=inactive]:hidden'
				forceMount
				value='run'
			>
				<RunScriptOutputPanel
					onOpenSetupScripts={actions.onOpenSetupScripts}
					onRunScript={actions.onRunScript}
					script={workspace.scripts.run}
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
			className='pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-l from-card via-card/90 to-transparent opacity-0 transition-opacity group-focus-within/dock-tab:opacity-100 group-hover/dock-tab:opacity-100'
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
	return (
		<button
			aria-label={`Close ${label} tab`}
			className='absolute top-1/2 right-1 grid size-4 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground opacity-0 transition-all hover:text-foreground focus-visible:opacity-100 group-hover/dock-tab:opacity-100'
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

/** Type guard for terminal-kind dock tabs. */
function isTerminalDockTab(tab: DockTabModel): tab is TerminalDockTabModel {
	return tab.kind === 'terminal';
}
