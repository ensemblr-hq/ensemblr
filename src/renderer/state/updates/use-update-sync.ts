import type { TFunction } from 'i18next';
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
	checkForUpdates,
	installUpdate,
	readUpdateStatus,
	subscribeUpdateStatusChanged,
} from '@/renderer/api/ensemblr';
import { failureText } from '@/renderer/lib/failure-text';
import { useMenuCommand } from '@/renderer/state/menu-commands';
import type { UpdateStatusSnapshot } from '@/shared/ipc/contracts/update';

import { updateStatusAtom } from './atoms';

/** Toast id for the update-ready prompt, so re-renders replace it rather than stack it. */
const READY_TOAST_ID = 'ensemblr-update-ready';

/** What the read hooks hand a surface that lets the user drive the updater. */
export interface UpdateActions {
	/** Runs a check now and reports the outcome, failures included. */
	check: () => Promise<void>;
	/** Restarts into a staged update. */
	install: () => Promise<void>;
}

/**
 * Keeps the update snapshot in step with main, registers the "Check for
 * Updates…" menu command, and raises the restart prompt once a build is staged.
 *
 * Mount once at the app root. Background failures are recorded on the snapshot
 * for Settings to show but are deliberately not toasted: a check runs every few
 * hours, and an offline laptop would otherwise nag all day. A check the user
 * asked for reports its outcome either way.
 */
export function useUpdateSync(): void {
	const { t } = useTranslation();
	const setStatus = useSetAtom(updateStatusAtom);
	const readyToastShownFor = useRef<string | null>(null);

	useEffect(() => {
		const unsubscribe = subscribeUpdateStatusChanged((event) =>
			setStatus(event.snapshot),
		);
		void readUpdateStatus()
			.then(setStatus)
			.catch(() => undefined);
		return unsubscribe;
	}, [setStatus]);

	const status = useAtomValue(updateStatusAtom);
	const restart = useCallback(async () => {
		const next = await installUpdate();
		setStatus(next);
	}, [setStatus]);

	useEffect(() => {
		if (status?.state !== 'ready' || !status.availableVersion) {
			// Turning updates off drops the staged build, and `install` refuses once
			// it has — so a restart prompt left on screen would be a button that
			// does nothing.
			if (readyToastShownFor.current) {
				readyToastShownFor.current = null;
				toast.dismiss(READY_TOAST_ID);
			}
			return;
		}
		if (readyToastShownFor.current === status.availableVersion) {
			return;
		}
		readyToastShownFor.current = status.availableVersion;
		toast.success(
			t('common:update.ready.title', 'Ensemblr {{version}} is ready', {
				version: status.availableVersion,
			}),
			{
				action: {
					label: t('common:update.ready.restart', 'Restart'),
					onClick: () => void restart(),
				},
				description: t(
					'common:update.ready.description',
					'Restart to finish installing. Agents still working are asked first.',
				),
				duration: Number.POSITIVE_INFINITY,
				id: READY_TOAST_ID,
			},
		);
	}, [restart, status?.availableVersion, status?.state, t]);

	const runCheck = useCallback(async () => {
		const next = await checkForUpdates();
		setStatus(next);
		reportCheck(next, t);
	}, [setStatus, t]);

	useMenuCommand('app.checkForUpdates', () => void runCheck());
}

/**
 * Tells the user how a check they asked for went. Exhaustive over
 * {@link UpdateStatusSnapshot.state} so a state added later is a compile error
 * rather than a menu item that answers nothing; `ready` is the one deliberate
 * silence, because the restart prompt above already says it, with the action.
 * @param snapshot - The state the check left the updater in
 * @param t - Translator bound to the active language
 */
function reportCheck(snapshot: UpdateStatusSnapshot, t: TFunction): void {
	switch (snapshot.state) {
		case 'error':
		case 'unsupported':
			toast.error(
				failureText(t, snapshot.failure) ??
					t('common:update.check-failed', 'The update check failed.'),
			);
			return;
		case 'disabled':
			toast.info(
				t(
					'common:update.disabled',
					'Automatic updates are off. Turn them on in Settings → General.',
				),
			);
			return;
		case 'available':
			reportAvailable(snapshot, t);
			return;
		case 'downloading':
			toast.info(
				t('common:update.downloading', 'Downloading Ensemblr {{version}}…', {
					version: snapshot.availableVersion ?? '',
				}),
			);
			return;
		case 'checking':
			toast.info(t('common:update.checking', 'Checking for updates…'));
			return;
		case 'idle':
			toast.success(
				t('common:update.up-to-date', 'Ensemblr {{version}} is up to date.', {
					version: snapshot.currentVersion,
				}),
			);
			return;
		case 'ready':
			return;
		default:
			snapshot.state satisfies never;
	}
}

/**
 * Reports the version a build that may check but not install has found, and
 * offers the release page it would be downloaded from — the only step this
 * build can take towards it.
 * @param snapshot - The state the check left the updater in
 * @param t - Translator bound to the active language
 */
function reportAvailable(snapshot: UpdateStatusSnapshot, t: TFunction): void {
	const releaseUrl = snapshot.releaseUrl;
	toast.info(
		t('common:update.available.title', 'Ensemblr {{version}} is available', {
			version: snapshot.availableVersion ?? '',
		}),
		{
			...(releaseUrl
				? {
						action: {
							label: t(
								'common:update.available.open-release',
								'Open the release page',
							),
							onClick: () => void window.ensemblr?.openExternal(releaseUrl),
						},
					}
				: {}),
			description: t(
				'common:update.available.description',
				'Ensemblr does not install this one itself — download it from the release page.',
			),
		},
	);
}
