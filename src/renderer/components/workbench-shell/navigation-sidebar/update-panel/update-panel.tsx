import type { TFunction } from 'i18next';
import {
	CircleArrowUpIcon,
	ExternalLinkIcon,
	TriangleAlertIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import { failureText } from '@/renderer/lib/failure-text';
import type { UpdateActions, UpdatePanelKind } from '@/renderer/state/updates';
import type { UpdateStatusSnapshot } from '@/shared/ipc/contracts/update';

/**
 * The sidebar's standing offer of a newer build: what it is, and what the user
 * can do about it.
 *
 * Which shape to take is decided by the caller rather than derived here, so the
 * wired wrapper can hold the last one through the `checking` main passes
 * through on every re-check instead of blinking the panel out for the round
 * trip.
 *
 * There is no close button by design. The panel leaves when the update does —
 * the user restarts into it and main reports `idle`, or they switch automatic
 * updates off in Settings → General and main reports `disabled`. Both exits are
 * states of the app rather than of this component, so nothing here has to
 * remember a dismissal across a reload.
 */
export function UpdatePanel({
	actions,
	kind,
	onOpenRelease,
	snapshot,
}: {
	actions: UpdateActions;
	kind: UpdatePanelKind;
	onOpenRelease: (releaseUrl: string) => void;
	snapshot: UpdateStatusSnapshot;
}) {
	const { t } = useTranslation();
	const [isBusy, setIsBusy] = useState(false);
	const version = snapshot.availableVersion ?? snapshot.currentVersion;
	/**
	 * Runs one updater call with the button held disabled for its duration, so
	 * the restart request cannot be queued twice behind the quit guard's prompt.
	 * @param action - The updater call to run
	 */
	const run = async (action: () => Promise<void>) => {
		setIsBusy(true);
		try {
			await action();
		} finally {
			setIsBusy(false);
		}
	};

	return (
		<section
			className='flex flex-col gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent p-2.5'
			data-sidebar-update-panel={kind}
		>
			<div className='flex items-start gap-2'>
				<PanelIcon kind={kind} />
				<div className='flex min-w-0 flex-col gap-0.5'>
					<p className='font-medium text-sidebar-foreground text-xs leading-4'>
						{panelTitle(kind, version, t)}
					</p>
					<p className='text-muted-foreground text-xxs leading-4'>
						{kind === 'failed'
							? (failureText(t, snapshot.failure) ??
								t(
									'workbench:navigation-sidebar.update.failed.description',
									'The download did not finish. Try again, or take the release page instead.',
								))
							: panelDescription(kind, t)}
					</p>
				</div>
			</div>

			<PanelAction
				isBusy={isBusy}
				kind={kind}
				onCheck={() => void run(actions.check)}
				onInstall={() => void run(actions.install)}
				onOpenRelease={onOpenRelease}
				releaseUrl={snapshot.releaseUrl}
			/>
		</section>
	);
}

/** Marks what the panel is reporting before the copy is read. */
function PanelIcon({ kind }: { kind: UpdatePanelKind }) {
	if (kind === 'downloading') {
		return <Spinner className='mt-0.5 size-3.5 text-muted-foreground' />;
	}
	if (kind === 'failed') {
		return <TriangleAlertIcon className='mt-0.5 size-3.5 text-status-danger' />;
	}
	return <CircleArrowUpIcon className='mt-0.5 size-3.5 text-accent-strong' />;
}

/**
 * Leaves for the release page — the step still open when this build may not
 * install the update, and the one still open when its download failed.
 */
function ReleaseLinkButton({
	onOpenRelease,
	releaseUrl,
	variant,
}: {
	onOpenRelease: (releaseUrl: string) => void;
	releaseUrl: string;
	variant: 'default' | 'ghost';
}) {
	const { t } = useTranslation();

	return (
		<Button
			className='w-full'
			onClick={() => onOpenRelease(releaseUrl)}
			size='sm'
			variant={variant}
		>
			<ExternalLinkIcon />
			{t(
				'workbench:navigation-sidebar.update.open-release',
				'Open the release page',
			)}
		</Button>
	);
}

/**
 * What the user can do about the update from here. A download in flight offers
 * nothing — the panel is reporting progress, and a second check would only
 * re-arm Squirrel over its own work.
 */
function PanelAction({
	isBusy,
	kind,
	onCheck,
	onInstall,
	onOpenRelease,
	releaseUrl,
}: {
	isBusy: boolean;
	kind: UpdatePanelKind;
	onCheck: () => void;
	onInstall: () => void;
	onOpenRelease: (releaseUrl: string) => void;
	releaseUrl: string | null;
}) {
	const { t } = useTranslation();

	if (kind === 'downloading') {
		return null;
	}
	if (kind === 'available') {
		return releaseUrl ? (
			<ReleaseLinkButton
				onOpenRelease={onOpenRelease}
				releaseUrl={releaseUrl}
				variant='default'
			/>
		) : null;
	}
	if (kind === 'failed') {
		return (
			<div className='flex flex-col gap-1.5'>
				<Button
					className='w-full'
					disabled={isBusy}
					onClick={onCheck}
					size='sm'
					variant='outline'
				>
					{isBusy ? <Spinner className='size-3.5' /> : null}
					{t('workbench:navigation-sidebar.update.retry', 'Try again')}
				</Button>
				{releaseUrl ? (
					<ReleaseLinkButton
						onOpenRelease={onOpenRelease}
						releaseUrl={releaseUrl}
						variant='ghost'
					/>
				) : null}
			</div>
		);
	}
	return (
		<Button
			className='w-full'
			disabled={isBusy}
			onClick={onInstall}
			size='sm'
			variant='default'
		>
			{isBusy ? <Spinner className='size-3.5' /> : null}
			{t('workbench:navigation-sidebar.update.restart', 'Restart to update')}
		</Button>
	);
}

/**
 * Headline for one panel shape, naming the version so the sidebar says which
 * build it is holding rather than only that one exists.
 * @param kind - The shape the panel is rendering
 * @param version - The version the panel is about
 * @param t - Translator bound to the active language
 * @returns The headline to show
 */
function panelTitle(
	kind: UpdatePanelKind,
	version: string,
	t: TFunction,
): string {
	switch (kind) {
		case 'ready':
			return t(
				'workbench:navigation-sidebar.update.ready.title',
				'Ensemblr {{version}} is ready',
				{ version },
			);
		case 'downloading':
			return t(
				'workbench:navigation-sidebar.update.downloading.title',
				'Downloading Ensemblr {{version}}',
				{ version },
			);
		case 'available':
			return t(
				'workbench:navigation-sidebar.update.available.title',
				'Ensemblr {{version}} is available',
				{ version },
			);
		case 'failed':
			return t(
				'workbench:navigation-sidebar.update.failed.title',
				'Ensemblr {{version}} did not download',
				{ version },
			);
	}
}

/**
 * The sentence under the headline for every shape but `failed`, which shows the
 * updater's own coded failure instead.
 * @param kind - The shape the panel is rendering
 * @param t - Translator bound to the active language
 * @returns The supporting line to show
 */
function panelDescription(
	kind: Exclude<UpdatePanelKind, 'failed'>,
	t: TFunction,
): string {
	switch (kind) {
		case 'ready':
			return t(
				'workbench:navigation-sidebar.update.ready.description',
				'Restart to finish installing. Agents still working are asked first.',
			);
		case 'downloading':
			return t(
				'workbench:navigation-sidebar.update.downloading.description',
				'A restart is offered here as soon as it finishes.',
			);
		case 'available':
			return t(
				'workbench:navigation-sidebar.update.available.description',
				'Ensemblr does not install this one itself — download it from the release page.',
			);
	}
}
