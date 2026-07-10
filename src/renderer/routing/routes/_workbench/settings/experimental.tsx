import { createFileRoute } from '@tanstack/react-router';
import { useAtom } from 'jotai';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Badge } from '@/renderer/components/ui/badge';
import { Switch } from '@/renderer/components/ui/switch';
import {
	autoRunAfterSetupAtom,
	inAppBrowserPreviewAtom,
	showDashboardAtom,
	showSidebarResourceUsageAtom,
	sidebarChatsModeAtom,
} from '@/renderer/state/preferences';

/** Route for the Experimental settings section; renders the experimental-features panel. */
export const Route = createFileRoute('/_workbench/settings/experimental')({
	component: ExperimentalSettings,
});

/** Experimental features panel toggling in-development options such as the dashboard, sidebar chats, and auto-run after setup. */
function ExperimentalSettings() {
	const [showDashboard, setShowDashboard] = useAtom(showDashboardAtom);
	const [sidebarChats, setSidebarChats] = useAtom(sidebarChatsModeAtom);
	const [autoRun, setAutoRun] = useAtom(autoRunAfterSetupAtom);
	const [resourceUsage, setResourceUsage] = useAtom(
		showSidebarResourceUsageAtom,
	);
	const [inAppBrowser, setInAppBrowser] = useAtom(inAppBrowserPreviewAtom);

	return (
		<SettingsSection
			description='Experimental features under development. Expect breaking changes. Voice, Graphite, cloud SSH, and the production React profiler are not part of v1 (see ADR 0020, 0021).'
			title='Experimental'
		>
			<SettingRow
				control={
					<Switch checked={showDashboard} onCheckedChange={setShowDashboard} />
				}
				description='Show the workspace dashboard between the sidebar and the workbench.'
				label='Dashboard'
			/>

			<SettingRow
				control={
					<Switch checked={sidebarChats} onCheckedChange={setSidebarChats} />
				}
				description='Add a Chats grouping mode to the workspace sidebar.'
				label='Sidebar chats'
			/>

			<SettingRow
				control={<Switch checked={autoRun} onCheckedChange={setAutoRun} />}
				description="Start a repository's run script automatically after a new local workspace finishes setup."
				label='Auto-run after setup'
			/>

			<SettingRow
				control={
					<Switch checked={inAppBrowser} onCheckedChange={setInAppBrowser} />
				}
				description='Open the preview URL in an in-app browser tab instead of your external browser.'
				label='In-app browser preview'
			/>

			<SettingRow
				control={
					<Switch checked={resourceUsage} onCheckedChange={setResourceUsage} />
				}
				description='Show CPU and memory usage in the workspace sidebar footer. Sampled on demand; can affect performance.'
				label='Show sidebar resource usage'
			/>

			<DeferredRow
				description='Create big terminals in the center pane.'
				label='Big terminal mode'
				note='Provided by the terminal dock (Milestone 5). No separate toggle.'
			/>
			<DeferredRow
				description='Allow up to 10 chat and terminal tabs per workspace.'
				label='Tab freak mode'
				note='Capped at 5 by ADR 0022.'
			/>
			<DeferredRow
				description='Enables speech-to-text in the chat composer.'
				label='Voice mode'
				note='Deferred — ADR 0020.'
			/>
			<DeferredRow
				description='Detect Graphite stacks and surface stack-aware UI.'
				label='Graphite stack support'
				note='Deferred — ADR 0020.'
			/>
		</SettingsSection>
	);
}

/** Settings row for a feature deferred out of v1: shows a "Deferred" badge, a disabled switch, and an explanatory note. */
function DeferredRow({
	description,
	label,
	note,
}: {
	description: string;
	label: string;
	note: string;
}) {
	return (
		<SettingRow
			control={
				<div className='flex items-center gap-2'>
					<Badge variant='outline'>Deferred</Badge>
					<Switch checked={false} disabled />
				</div>
			}
			description={description}
			label={label}
		>
			<p className='mt-1 text-muted-foreground text-xs'>{note}</p>
		</SettingRow>
	);
}
