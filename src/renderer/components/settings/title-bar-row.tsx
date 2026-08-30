import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { relaunchApp } from '@/renderer/api/ensemblr';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { Button } from '@/renderer/components/ui/button';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import { detectPlatform, readWindowChrome } from '@/renderer/lib/window-chrome';
import { titleBarAtom } from '@/renderer/state/preferences';
import { DEFAULT_APP_SETTINGS } from '@/shared/config';
import { supportsTitleBarPreference } from '@/shared/window-chrome';

/**
 * Settings → Appearance row choosing who draws the title bar.
 *
 * Hidden where the platform ignores the preference, which today is everywhere
 * but Linux. `titleBarStyle` is a `BrowserWindow` constructor option, so the
 * choice needs a relaunch; the row offers one that still drains running agents
 * rather than leaving the user to quit and reopen.
 */
export function TitleBarRow() {
	const { t } = useTranslation();
	const [titleBar, setTitleBar] = useAtom(titleBarAtom);

	if (!supportsTitleBarPreference(detectPlatform())) {
		return null;
	}

	const needsRelaunch = titleBar !== readWindowChrome().titleBar;

	return (
		<SettingRow
			control={
				<div className='flex items-center gap-2'>
					{needsRelaunch ? (
						<Button
							onClick={() => void relaunchApp()}
							size='sm'
							variant='outline'
						>
							{t('settings:appearance.title-bar.relaunch', 'Relaunch')}
						</Button>
					) : null}
					<Select
						onValueChange={(value) => setTitleBar(value as typeof titleBar)}
						value={titleBar}
					>
						<SelectTrigger className='w-40' size='sm'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='custom'>
								{t('settings:appearance.title-bar.custom', 'Ensemblr')}
							</SelectItem>
							<SelectItem value='system'>
								{t('settings:appearance.title-bar.system', 'System')}
							</SelectItem>
						</SelectContent>
					</Select>
				</div>
			}
			description={t(
				'settings:appearance.title-bar.description',
				'Whether Ensemblr draws its own title bar and window controls, or lets your desktop decorate the window. Takes effect after a relaunch.',
			)}
			label={t('settings:appearance.title-bar.label', 'Title bar')}
			modified={titleBar !== DEFAULT_APP_SETTINGS.appearance.titleBar}
			onReset={() => setTitleBar(DEFAULT_APP_SETTINGS.appearance.titleBar)}
		/>
	);
}
