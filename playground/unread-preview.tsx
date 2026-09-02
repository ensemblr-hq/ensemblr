import { useState } from 'react';

import { SidebarMenuButton } from '@/renderer/components/ui/sidebar';
import { LastUnreadButton } from '@/renderer/components/workbench-shell/conversation-panel/composer/last-unread-button';
import { SessionTabs } from '@/renderer/components/workbench-shell/conversation-panel/session-tabs';
import { WorkspaceSidebarItemContent } from '@/renderer/components/workbench-shell/workspace-sidebar-item/item-content';
import { getWorkspaceSidebarState } from '@/renderer/lib/workbench';

import {
	ControlGroup,
	SceneControls,
	SceneSection,
	SceneToggle,
} from './scene-chrome.tsx';
import { StubbedWorkbenchLayout } from './stubbed-workbench-layout.tsx';
import {
	UNREAD_ROW_CASES,
	UNREAD_SESSION_TAB_IDS,
	UNREAD_SESSION_TABS,
} from './unread-fixtures.ts';

const COUNT_CHOICES = [1, 3, 9] as const;

/**
 * Drives the three surfaces per-chat unread state touches — the sidebar row's
 * dot, the tab strip's marker, and the composer's jump pill — off the shipped
 * components, so the marker sizes and the way they sit next to the diff stats,
 * the dock dot, and the tab close control can be judged together.
 *
 * Every surface is driven by props rather than by seeding the unread atom: the
 * markers are the thing under review, and reproducing a nine-unread workspace by
 * writing nine entries into `localStorage` would make the scene depend on the
 * bookkeeping instead of showing the pixels.
 */
export function UnreadScene() {
	const [showUnread, setShowUnread] = useState(true);
	const [countOverride, setCountOverride] = useState<number | null>(null);
	const [activeTabId, setActiveTabId] = useState('tab-active');

	const unreadKeys = new Set(showUnread ? UNREAD_SESSION_TAB_IDS : []);
	const activeSession =
		UNREAD_SESSION_TABS.find((session) => session.id === activeTabId) ??
		UNREAD_SESSION_TABS[0];

	return (
		<div className='flex flex-col gap-8'>
			<SceneControls>
				<ControlGroup label='unread'>
					<SceneToggle
						isActive={showUnread}
						label='on'
						onClick={() => setShowUnread(true)}
					/>
					<SceneToggle
						isActive={!showUnread}
						label='off'
						onClick={() => setShowUnread(false)}
					/>
				</ControlGroup>
				<ControlGroup label='count'>
					<SceneToggle
						isActive={countOverride === null}
						label='per row'
						onClick={() => setCountOverride(null)}
					/>
					{COUNT_CHOICES.map((count) => (
						<SceneToggle
							isActive={countOverride === count}
							key={count}
							label={String(count)}
							onClick={() => setCountOverride(count)}
						/>
					))}
				</ControlGroup>
			</SceneControls>

			<SceneSection
				label='sidebar rows'
				note='The dot sits ahead of the diff stats and the dock-activity dot; the exact count is in its tooltip, and the name carries the unread weight.'
			>
				<StubbedWorkbenchLayout>
					<div className='w-72 rounded-lg border border-border bg-sidebar p-2'>
						{UNREAD_ROW_CASES.map((rowCase) => {
							const unreadCount = resolveRowCount(
								rowCase.unreadCount,
								countOverride,
								showUnread,
							);

							return (
								<div
									className='flex flex-col gap-0.5'
									key={rowCase.workspace.id}
								>
									<SidebarMenuButton className='h-auto min-h-12 items-start gap-2 py-2'>
										<WorkspaceSidebarItemContent
											dockActivityState={
												rowCase.workspace.id === 'row-unread-busy'
													? 'running'
													: null
											}
											hasDiffStats={
												rowCase.workspace.changeSummary.additions > 0
											}
											isUnread={unreadCount > 0}
											pendingLifecycle={null}
											sidebarState={getWorkspaceSidebarState(
												rowCase.workspace,
												{
													agentBusy: false,
												},
											)}
											unreadCount={unreadCount}
											workspace={rowCase.workspace}
										/>
									</SidebarMenuButton>
									<span className='px-2 pb-2 font-mono text-muted-foreground text-xxs'>
										{rowCase.note}
									</span>
								</div>
							);
						})}
					</div>
				</StubbedWorkbenchLayout>
			</SceneSection>

			<SceneSection
				label='tab strip'
				note='An unread inactive tab lifts out of the muted text colour and carries a dot in the close-button slot; hover a tab to watch the close control take the slot back. The active tab never shows one.'
			>
				<div className='overflow-hidden rounded-lg border border-border'>
					<SessionTabs
						activeSession={activeSession}
						closedSessions={[]}
						onLaunchHarness={async () => null}
						onSessionTabChange={setActiveTabId}
						onSessionTabClose={() => undefined}
						onSessionTabOpen={async () => null}
						onSessionTabPin={() => undefined}
						onSessionTabRestore={() => undefined}
						onSessionTabsReorder={() => undefined}
						sessions={UNREAD_SESSION_TABS}
						unreadKeys={unreadKeys}
					/>
				</div>
			</SceneSection>

			<SceneSection
				label='last unread pill'
				note='Floats above the composer card, right-aligned, and is absent entirely when nothing is unread — so its arrival never shifts the input under the cursor.'
			>
				<div className='relative mx-auto w-full max-w-4xl pt-9'>
					{showUnread ? (
						<div className='absolute top-0 right-0 flex justify-end'>
							<LastUnreadButton
								onClick={() => undefined}
								workspaceName='Keymap regressions'
							/>
						</div>
					) : null}
					<div className='flex h-28 flex-col justify-end rounded-xl border border-border bg-pane/80 p-4 text-muted-foreground text-sm shadow-panel'>
						Ask to make changes, @mention files, run /commands
					</div>
				</div>
			</SceneSection>
		</div>
	);
}

/**
 * Picks the count a row renders, letting the sidebar control override the
 * per-row fixture so one workspace can be pushed through 1 / 3 / 9 in place.
 * @param rowCount - The row's own fixture count
 * @param override - Count forced by the scene control, or null
 * @param showUnread - Whether the scene is showing unread state at all
 * @returns The count to render
 */
function resolveRowCount(
	rowCount: number,
	override: number | null,
	showUnread: boolean,
): number {
	if (!showUnread || rowCount === 0) {
		return 0;
	}
	return override ?? rowCount;
}
