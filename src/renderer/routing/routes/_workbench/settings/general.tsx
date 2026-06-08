import { createFileRoute } from '@tanstack/react-router';
import { useAtom } from 'jotai';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Button } from '@/renderer/components/ui/button';
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
	completionSoundAtom,
	desktopNotificationsAtom,
	followUpBehaviorAtom,
	sendShortcutAtom,
	showMcpStatusInChatAtom,
	softenCertaintyAtom,
	toolCallCollapseAtom,
} from '@/renderer/state/preferences/atoms';

export const Route = createFileRoute('/_workbench/settings/general')({
	component: GeneralSettings,
});

function GeneralSettings() {
	const [sendShortcut, setSendShortcut] = useAtom(sendShortcutAtom);
	const [followUp, setFollowUp] = useAtom(followUpBehaviorAtom);
	const [notifications, setNotifications] = useAtom(desktopNotificationsAtom);
	const [completionSound, setCompletionSound] = useAtom(completionSoundAtom);
	const [autoConvertLong, setAutoConvertLong] = useAtom(
		autoConvertLongTextAtom,
	);
	const [softenCertainty, setSoftenCertainty] = useAtom(softenCertaintyAtom);
	const [showContext, setShowContext] = useAtom(alwaysShowContextUsageAtom);
	const [caffeinate, setCaffeinate] = useAtom(caffeinateWhileRunningAtom);
	const [showMcp, setShowMcp] = useAtom(showMcpStatusInChatAtom);
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
							<SelectItem value='enter'>Enter</SelectItem>
							<SelectItem value='mod+enter'>Cmd + Enter</SelectItem>
						</SelectContent>
					</Select>
				}
				description='Use Shift+Enter for new lines.'
				label='Send messages with'
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
				description='Queue messages to send after the agent finishes, or steer the agent mid-turn. Use Cmd+J to queue.'
				label='Follow-up behavior'
			/>

			<SettingRow
				control={
					<Switch checked={notifications} onCheckedChange={setNotifications} />
				}
				description='Get notified when Pi finishes working in a chat.'
				label='Desktop notifications'
			/>

			<SettingRow
				control={
					<div className='flex items-center gap-2'>
						<Select
							onValueChange={(v) =>
								setCompletionSound(v as typeof completionSound)
							}
							value={completionSound}
						>
							<SelectTrigger className='w-32' size='sm'>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value='off'>Off</SelectItem>
								<SelectItem value='chime'>Chime 1</SelectItem>
								<SelectItem value='chime-2'>Chime 2</SelectItem>
								<SelectItem value='soft-ding'>Soft ding</SelectItem>
								<SelectItem value='pop'>Pop</SelectItem>
							</SelectContent>
						</Select>
						<Button size='sm' variant='ghost'>
							Test
						</Button>
					</div>
				}
				description='Choose what plays when Pi finishes working in a chat.'
				label='Completion sound'
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
			/>

			<SettingRow
				control={
					<Switch
						checked={softenCertainty}
						onCheckedChange={setSoftenCertainty}
					/>
				}
				description='Strip overconfident phrases like "You’re absolutely right!" from Pi messages.'
				label='Soften AI certainty'
			/>

			<SettingRow
				control={
					<Switch checked={showContext} onCheckedChange={setShowContext} />
				}
				description='Always show context usage. By default, only shown when more than 70% is used.'
				label='Always show context usage'
			/>

			<SettingRow
				control={
					<Switch checked={caffeinate} onCheckedChange={setCaffeinate} />
				}
				description='Prevent your Mac from sleeping while Pi is actively working. Shuts off below 10% battery.'
				label='Caffeinate while agents are running'
			/>

			<SettingRow
				control={<Switch checked={showMcp} onCheckedChange={setShowMcp} />}
				description='Show a per-session MCP server status indicator in the composer.'
				label='Show MCP status in chat'
			/>

			<SettingRow
				control={
					<Switch
						checked={toolCalls === 'expanded'}
						onCheckedChange={(v) => setToolCalls(v ? 'expanded' : 'collapsed')}
					/>
				}
				description='Show all tool calls expanded by default instead of collapsed. Toggle with ⌃⌃ O.'
				label="Don't collapse tool calls"
			/>
		</SettingsSection>
	);
}
