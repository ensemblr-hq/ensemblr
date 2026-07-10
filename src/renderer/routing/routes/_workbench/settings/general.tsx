import { createFileRoute } from '@tanstack/react-router';
import { useAtom } from 'jotai';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import { Switch } from '@/renderer/components/ui/switch';
import {
	alwaysShowContextUsageAtom,
	autoConvertLongTextAtom,
	caffeinateWhileRunningAtom,
	desktopNotificationsAtom,
	followUpBehaviorAtom,
	sendShortcutAtom,
	toolCallCollapseAtom,
} from '@/renderer/state/preferences';
import { DEFAULT_APP_SETTINGS } from '@/shared/config/app-settings';
import { formatShortcut } from '@/shared/keymap';

/** Route for the General settings section; renders the general-settings panel. */
export const Route = createFileRoute('/_workbench/settings/general')({
	component: GeneralSettings,
});

/** Factory defaults; a row shows its "modified" accent when its value differs. */
const DEFAULTS = DEFAULT_APP_SETTINGS.general;

const TOOL_CALL_TOGGLE_HINT = formatShortcut('toolCalls.toggleCollapse');
const SEND_ENTER_HINT = formatShortcut('composer.submit');
const SEND_MOD_ENTER_HINT = formatShortcut('composer.submitWithMod');
const NEWLINE_HINT = formatShortcut('composer.newline');

/** General settings panel for the send shortcut, follow-up behavior, notifications, and other core chat preferences. */
function GeneralSettings() {
	const [sendShortcut, setSendShortcut] = useAtom(sendShortcutAtom);
	const [followUp, setFollowUp] = useAtom(followUpBehaviorAtom);
	const [notifications, setNotifications] = useAtom(desktopNotificationsAtom);
	const [autoConvertLong, setAutoConvertLong] = useAtom(
		autoConvertLongTextAtom,
	);
	const [showContext, setShowContext] = useAtom(alwaysShowContextUsageAtom);
	const [caffeinate, setCaffeinate] = useAtom(caffeinateWhileRunningAtom);
	const [toolCalls, setToolCalls] = useAtom(toolCallCollapseAtom);

	return (
		<SettingsSection title='General'>
			<SettingRow
				control={
					<Select
						onValueChange={(v) => setSendShortcut(v as typeof sendShortcut)}
						value={sendShortcut}
					>
						<SelectTrigger className='w-40' size='sm'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='enter'>{SEND_ENTER_HINT}</SelectItem>
							<SelectItem value='mod+enter'>{SEND_MOD_ENTER_HINT}</SelectItem>
						</SelectContent>
					</Select>
				}
				description={`Use ${NEWLINE_HINT} for new lines.`}
				label='Send messages with'
				modified={sendShortcut !== DEFAULTS.sendShortcut}
			/>

			<SettingRow
				control={
					<Select
						onValueChange={(v) => setFollowUp(v as typeof followUp)}
						value={followUp}
					>
						<SelectTrigger className='w-40' size='sm'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='steer'>Steer</SelectItem>
							<SelectItem value='queue'>Queue</SelectItem>
							<SelectItem value='block'>Block</SelectItem>
						</SelectContent>
					</Select>
				}
				description='Queue messages to send after the agent finishes, or steer the agent mid-turn. Use ⌘J to queue.'
				label='Follow-up behavior'
				modified={followUp !== DEFAULTS.followUpBehavior}
			/>

			<SettingRow
				control={
					<Switch checked={notifications} onCheckedChange={setNotifications} />
				}
				description='Get notified when Pi finishes working in a chat.'
				label='Desktop notifications'
				modified={notifications !== DEFAULTS.desktopNotifications}
			/>

			<SettingRow
				control={
					<Switch
						checked={autoConvertLong}
						onCheckedChange={setAutoConvertLong}
					/>
				}
				description='Convert pasted text over 5000 characters into text attachments.'
				label='Auto-convert long text'
				modified={autoConvertLong !== DEFAULTS.autoConvertLongText}
			/>

			<SettingRow
				control={
					<Switch checked={showContext} onCheckedChange={setShowContext} />
				}
				description='Always show context usage. By default, only shown when more than 70% is used.'
				label='Always show context usage'
				modified={showContext !== DEFAULTS.alwaysShowContextUsage}
			/>

			<SettingRow
				control={
					<Switch checked={caffeinate} onCheckedChange={setCaffeinate} />
				}
				description='Prevent your Mac from sleeping while Pi is actively working. Shuts off below 10% battery.'
				label='Caffeinate while agents are running'
				modified={caffeinate !== DEFAULTS.caffeinateWhileRunning}
			/>

			<SettingRow
				control={
					<Switch
						checked={toolCalls === 'expanded'}
						onCheckedChange={(v) => setToolCalls(v ? 'expanded' : 'collapsed')}
					/>
				}
				description={`Show all tool calls expanded by default instead of collapsed. Toggle with ${TOOL_CALL_TOGGLE_HINT}.`}
				label="Don't collapse tool calls"
				modified={toolCalls !== DEFAULTS.toolCallCollapse}
			/>
		</SettingsSection>
	);
}
