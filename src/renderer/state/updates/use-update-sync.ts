import type { TFunction } from 'i18next';
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect } from 'react';
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
import { navigationSidebarVisibleAtom } from '@/renderer/state/sidebar';
import type { UpdateStatusSnapshot } from '@/shared/ipc/contracts/update';

import { updateStatusAtom } from './atoms';
import { resolveUpdatePanelKind } from './update-panel-kind';

/** Toast id for the update-ready answer, so a second check replaces it rather than stacking it. */
const READY_TOAST_ID = 'ensemblr-update-ready';

/** What the read hooks hand a surface that lets the user drive the updater. */
export interface UpdateActions {
	/** Runs a check now and reports the outcome, failures included. */
	check: () => Promise<void>;
	/** Restarts into a staged update. */
	install: () => Promise<void>;
}

/**
 * Keeps the update snapshot in step with main and registers the "Check for
 * Updates…" menu command.
 *
 * Mount once at the app root. A newer build is not announced from here on its
 * own schedule: the navigation sidebar pins an update panel for as long as one
 * is outstanding, which a toast could never do — a toast the user has to be
 * able to dismiss is the wrong shape for an offer that must survive until it is
 * taken or refused. Background failures are recorded on the snapshot for
 * Settings to show but are deliberately not toasted either: a check runs every
 * few hours, and an offline laptop would otherwise nag all day.
 *
 * A check the user *asked* for still answers, here, whenever the panel that
 * would otherwise carry the answer is not on screen.
 */
export function useUpdateSync(): void {
	const { t } = useTranslation();
	const setStatus = useSetAtom(updateStatusAtom);
	const sidebarVisible = useAtomValue(navigationSidebarVisibleAtom);

	useEffect(() => {
		const unsubscribe = subscribeUpdateStatusChanged((event) =>
			setStatus(event.snapshot),
		);
		void readUpdateStatus()
			.then(setStatus)
			.catch(() => undefined);
		return unsubscribe;
	}, [setStatus]);

	const restart = useCallback(async () => {
		setStatus(await installUpdate());
	}, [setStatus]);

	const runCheck = useCallback(async () => {
		const next = await checkForUpdates();
		setStatus(next);
		reportCheck(next, t, {
			onRestart: () => void restart(),
			panelIsVisible: sidebarVisible && resolveUpdatePanelKind(next) !== null,
		});
	}, [restart, setStatus, sidebarVisible, t]);

	useMenuCommand('app.checkForUpdates', () => void runCheck());
}

/**
 * Tells the user how a check they asked for went.
 *
 * Silent only when the sidebar's update panel is genuinely on screen — it names
 * the same version and carries the same action, so a toast beside it would be
 * the same news twice. A collapsed sidebar, or a route that renders outside the
 * workbench shell, leaves nothing else to say it, and a menu item that answers
 * nothing is worse than one that repeats itself. Otherwise exhaustive over
 * {@link UpdateStatusSnapshot.state}, so a state added later is a compile error
 * rather than a menu item that answers nothing.
 * @param snapshot - The state the check left the updater in
 * @param t - Translator bound to the active language
 * @param surfaces - Whether the panel already speaks for this outcome, and how to restart when it does not
 */
function reportCheck(
	snapshot: UpdateStatusSnapshot,
	t: TFunction,
	surfaces: { onRestart: () => void; panelIsVisible: boolean },
): void {
	if (surfaces.panelIsVisible) {
		return;
	}
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
		case 'ready':
			reportReady(snapshot, t, surfaces.onRestart);
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

/**
 * Reports a staged build and offers the restart that finishes it, for the
 * checks made where the sidebar panel is not there to carry the button.
 * @param snapshot - The state the check left the updater in
 * @param t - Translator bound to the active language
 * @param onRestart - Restarts into the staged update
 */
function reportReady(
	snapshot: UpdateStatusSnapshot,
	t: TFunction,
	onRestart: () => void,
): void {
	toast.success(
		t('common:update.ready.title', 'Ensemblr {{version}} is ready', {
			version: snapshot.availableVersion ?? '',
		}),
		{
			action: {
				label: t('common:update.ready.restart', 'Restart'),
				onClick: onRestart,
			},
			description: t(
				'common:update.ready.description',
				'Restart to finish installing. Agents still working are asked first.',
			),
			id: READY_TOAST_ID,
		},
	);
}
