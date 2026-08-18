import type { TFunction } from 'i18next';
import { useAtom } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsCodeValue } from '@/renderer/components/settings/settings-code-value';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import { Switch } from '@/renderer/components/ui/switch';
import { failureText } from '@/renderer/lib/failure-text';
import { automaticUpdatesAtom } from '@/renderer/state/preferences';
import { useUpdateActions, useUpdateStatus } from '@/renderer/state/updates';
import { DEFAULT_APP_SETTINGS } from '@/shared/config';
import type { UpdateStatusSnapshot } from '@/shared/ipc/contracts/update';

/**
 * Names the updater's state in the app language. Main reports a locale-neutral
 * state and a coded failure, so the whole row reads translated rather than
 * showing either raw.
 * @param snapshot - The updater's current state
 * @param t - Translator bound to the active language
 * @returns The status line to show under the version
 */
function statusLabel(snapshot: UpdateStatusSnapshot, t: TFunction): string {
	switch (snapshot.state) {
		case 'checking':
			return t('settings:general.updates.status.checking', 'Checking…');
		case 'downloading':
			return t(
				'settings:general.updates.status.downloading',
				'Downloading {{version}}…',
				{ version: snapshot.availableVersion ?? '' },
			);
		case 'ready':
			return t(
				'settings:general.updates.status.ready',
				'{{version}} is ready — restart to install.',
				{ version: snapshot.availableVersion ?? '' },
			);
		case 'error':
		case 'unsupported':
			return (
				failureText(t, snapshot.failure) ??
				t('settings:general.updates.status.error', 'The update check failed.')
			);
		case 'disabled':
			return t(
				'settings:general.updates.status.disabled',
				'Ensemblr will not check for updates.',
			);
		case 'idle':
			return t(
				'settings:general.updates.status.idle',
				'Ensemblr is up to date.',
			);
	}
}

/**
 * The two Settings → General rows the in-app updater owns: the switch that hands
 * the install to something else, and the running version with whatever the
 * updater is doing about it.
 */
export function SoftwareUpdateRows() {
	const { t } = useTranslation();
	const snapshot = useUpdateStatus();
	const { check, install } = useUpdateActions();
	const [automaticUpdates, setAutomaticUpdates] = useAtom(automaticUpdatesAtom);
	const [busy, setBusy] = useState(false);

	if (!snapshot) {
		return null;
	}

	const ready = snapshot.state === 'ready';
	const disabled = snapshot.state === 'disabled';
	/**
	 * Runs one updater action with the button disabled for its duration, so a
	 * slow check cannot be started twice.
	 * @param action - The updater call to run
	 */
	const runAction = async (action: () => Promise<void>) => {
		setBusy(true);
		try {
			await action();
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<SettingRow
				control={
					<Switch
						checked={automaticUpdates}
						disabled={snapshot.state === 'unsupported'}
						onCheckedChange={setAutomaticUpdates}
					/>
				}
				description={t(
					'settings:general.automatic-updates.description',
					'Check for a newer build, download it, and offer to restart into it. Turn this off if a package manager owns this copy — Homebrew, for instance — so the two never fight over the same bundle.',
				)}
				label={t(
					'settings:general.automatic-updates.label',
					'Update Ensemblr automatically',
				)}
				modified={
					automaticUpdates !== DEFAULT_APP_SETTINGS.general.automaticUpdates
				}
				onReset={() =>
					setAutomaticUpdates(DEFAULT_APP_SETTINGS.general.automaticUpdates)
				}
			/>

			<SettingRow
				control={
					<Button
						disabled={busy || disabled || snapshot.state === 'unsupported'}
						onClick={() => void runAction(ready ? install : check)}
						size='sm'
						variant={ready ? 'default' : 'outline'}
					>
						{busy ? <Spinner className='size-3.5' /> : null}
						{ready
							? t('settings:general.updates.restart', 'Restart to update')
							: t('settings:general.updates.check', 'Check for updates')}
					</Button>
				}
				description={statusLabel(snapshot, t)}
				label={
					<span className='flex items-center gap-2'>
						{t('settings:general.updates.label', 'Ensemblr version')}
						<SettingsCodeValue value={snapshot.currentVersion} />
						{snapshot.channel === 'canary' ? (
							<Badge variant='secondary'>
								{t('settings:general.updates.channel.canary', 'Nightly')}
							</Badge>
						) : null}
					</span>
				}
			/>
		</>
	);
}
