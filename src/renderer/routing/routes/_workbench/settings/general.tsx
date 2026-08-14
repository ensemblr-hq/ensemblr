import { createFileRoute } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { RootDirectoryRow } from '@/renderer/components/settings/root-directory-row';
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
	languageAtom,
	notificationSoundAtom,
	sendShortcutAtom,
	toolCallCollapseAtom,
} from '@/renderer/state/preferences';
import { DEFAULT_APP_SETTINGS } from '@/shared/config';
import { APP_LANGUAGES, LANGUAGE_ENDONYMS } from '@/shared/i18n';
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
const QUEUE_HINT = formatShortcut('composer.queue');

/** General settings panel for the send shortcut, follow-up behavior, notifications, and other core chat preferences. */
function GeneralSettings() {
	const { t } = useTranslation();
	const [language, setLanguage] = useAtom(languageAtom);
	const [sendShortcut, setSendShortcut] = useAtom(sendShortcutAtom);
	const [followUp, setFollowUp] = useAtom(followUpBehaviorAtom);
	const [notifications, setNotifications] = useAtom(desktopNotificationsAtom);
	const [notificationSound, setNotificationSound] = useAtom(
		notificationSoundAtom,
	);
	const [autoConvertLong, setAutoConvertLong] = useAtom(
		autoConvertLongTextAtom,
	);
	const [showContext, setShowContext] = useAtom(alwaysShowContextUsageAtom);
	const [caffeinate, setCaffeinate] = useAtom(caffeinateWhileRunningAtom);
	const [toolCalls, setToolCalls] = useAtom(toolCallCollapseAtom);

	return (
		<SettingsSection
			description={t(
				'settings:general.description',
				'How chats behave day to day: the language Ensemblr speaks, how messages are sent, what it does while an agent is working, and where it keeps its repositories.',
			)}
			title={t('settings:general.title', 'General')}
		>
			<SettingRow
				control={
					<Select
						onValueChange={(v) => setLanguage(v as typeof language)}
						value={language}
					>
						<SelectTrigger className='w-40' size='sm'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='system'>
								{t('settings:general.language.system', 'System')}
							</SelectItem>
							{/* Endonyms read identically in every UI language, which is the
							    point of using one — a user stranded in a language they cannot
							    read can still find their own. */}
							{APP_LANGUAGES.map((code) => (
								<SelectItem key={code} value={code}>
									{LANGUAGE_ENDONYMS[code]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				}
				description={t(
					'settings:general.language.description',
					'Interface language. System follows your macOS language order.',
				)}
				label={t('settings:general.language.label', 'Language')}
				modified={language !== DEFAULTS.language}
				onReset={() => setLanguage(DEFAULTS.language)}
			/>

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
				description={t(
					'settings:general.send-shortcut.description',
					'Use {{shortcut}} for new lines.',
					{ shortcut: NEWLINE_HINT },
				)}
				label={t('settings:general.send-shortcut.label', 'Send messages with')}
				modified={sendShortcut !== DEFAULTS.sendShortcut}
				onReset={() => setSendShortcut(DEFAULTS.sendShortcut)}
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
							<SelectItem value='steer'>
								{t('settings:general.follow-up.steer', 'Steer')}
							</SelectItem>
							<SelectItem value='queue'>
								{t('settings:general.follow-up.queue', 'Queue')}
							</SelectItem>
							<SelectItem value='block'>
								{t('settings:general.follow-up.block', 'Block')}
							</SelectItem>
						</SelectContent>
					</Select>
				}
				description={t(
					'settings:general.follow-up.description',
					'Steer the agent mid-turn, queue messages until it finishes, or hold them until you send them. A queued message stays editable. {{shortcut}} queues in any mode.',
					{ shortcut: QUEUE_HINT },
				)}
				label={t('settings:general.follow-up.label', 'Follow-up behavior')}
				modified={followUp !== DEFAULTS.followUpBehavior}
				onReset={() => setFollowUp(DEFAULTS.followUpBehavior)}
			/>

			<SettingRow
				control={
					<Switch checked={notifications} onCheckedChange={setNotifications} />
				}
				description={t(
					'settings:general.notifications.description',
					'Get notified when an agent finishes working in a chat.',
				)}
				label={t(
					'settings:general.notifications.label',
					'Desktop notifications',
				)}
				modified={notifications !== DEFAULTS.desktopNotifications}
				onReset={() => setNotifications(DEFAULTS.desktopNotifications)}
			/>

			<SettingRow
				control={
					<Switch
						checked={notificationSound}
						onCheckedChange={setNotificationSound}
					/>
				}
				description={t(
					'settings:general.notification-sound.description',
					'Play a sound when a chat needs your attention.',
				)}
				label={t(
					'settings:general.notification-sound.label',
					'Notification sound',
				)}
				modified={notificationSound !== DEFAULTS.notificationSound}
				onReset={() => setNotificationSound(DEFAULTS.notificationSound)}
			/>

			<SettingRow
				control={
					<Switch
						checked={autoConvertLong}
						onCheckedChange={setAutoConvertLong}
					/>
				}
				description={t(
					'settings:general.auto-convert.description',
					'Convert pasted text over 5000 characters into text attachments.',
				)}
				label={t(
					'settings:general.auto-convert.label',
					'Auto-convert long text',
				)}
				modified={autoConvertLong !== DEFAULTS.autoConvertLongText}
				onReset={() => setAutoConvertLong(DEFAULTS.autoConvertLongText)}
			/>

			<SettingRow
				control={
					<Switch checked={showContext} onCheckedChange={setShowContext} />
				}
				description={t(
					'settings:general.context-usage.description',
					'Always show context usage. By default, only shown when more than 70% is used.',
				)}
				label={t(
					'settings:general.context-usage.label',
					'Always show context usage',
				)}
				modified={showContext !== DEFAULTS.alwaysShowContextUsage}
				onReset={() => setShowContext(DEFAULTS.alwaysShowContextUsage)}
			/>

			<SettingRow
				control={
					<Switch checked={caffeinate} onCheckedChange={setCaffeinate} />
				}
				description={t(
					'settings:general.caffeinate.description',
					'Prevent your Mac from sleeping while an agent is actively working. Shuts off below 10% battery.',
				)}
				label={t(
					'settings:general.caffeinate.label',
					'Caffeinate while agents are running',
				)}
				modified={caffeinate !== DEFAULTS.caffeinateWhileRunning}
				onReset={() => setCaffeinate(DEFAULTS.caffeinateWhileRunning)}
			/>

			<SettingRow
				control={
					<Switch
						checked={toolCalls === 'expanded'}
						onCheckedChange={(v) => setToolCalls(v ? 'expanded' : 'collapsed')}
					/>
				}
				description={t(
					'settings:general.tool-calls.description',
					'Show all tool calls expanded by default instead of collapsed. Toggle with {{shortcut}}.',
					{ shortcut: TOOL_CALL_TOGGLE_HINT },
				)}
				label={t(
					'settings:general.tool-calls.label',
					"Don't collapse tool calls",
				)}
				modified={toolCalls !== DEFAULTS.toolCallCollapse}
				onReset={() => setToolCalls(DEFAULTS.toolCallCollapse)}
			/>

			<RootDirectoryRow />
		</SettingsSection>
	);
}
