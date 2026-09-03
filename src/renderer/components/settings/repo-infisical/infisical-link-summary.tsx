import { RefreshCwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ConfirmDestructiveButton } from '@/renderer/components/settings/confirm-destructive-button';
import { StatusBadge } from '@/renderer/components/status-badge';
import { Button } from '@/renderer/components/ui/button';
import { InfisicalLogo } from '@/renderer/components/workbench-shell/source-provider-logo';
import { cn } from '@/renderer/lib/utils';
import type { InfisicalLinkSnapshot } from '@/shared/ipc/contracts/infisical';

/** Props for the strip that answers "is this repository wired up?" at a glance. */
interface InfisicalLinkSummaryProps {
	link: InfisicalLinkSnapshot | null;
	onSync: () => void;
	onUnlink: () => void;
	syncing: boolean;
	unlinking: boolean;
}

/**
 * Header strip for the secrets panel: which project this repository resolves
 * against, whether that link is complete, when it last pulled, and the two
 * actions that operate on the saved link rather than on the form below it —
 * so it keeps describing what is saved while the form below is being edited.
 */
export function InfisicalLinkSummary({
	link,
	onSync,
	onUnlink,
	syncing,
	unlinking,
}: InfisicalLinkSummaryProps) {
	const { t } = useTranslation();
	const canOperate = Boolean(link?.accountId);
	/* A discovered link has no saved account to spend, so syncing it would only
	   fail. Unlinking stays: it is the one way to tell Ensemblr to stop reading
	   a `.infisical.json` it found, and it writes nothing into the repository. */
	const showsSync = Boolean(link) && link?.origin !== 'infisical-cli';

	return (
		<div className='flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card/40 px-4 py-3'>
			<InfisicalLogo aria-hidden='true' className='size-5 shrink-0' />
			<div className='min-w-0 flex-1 space-y-1'>
				<div className='flex min-w-0 flex-wrap items-center gap-2'>
					<span
						className={cn(
							'truncate font-medium text-sm',
							link ? 'text-foreground' : 'text-muted-foreground',
						)}
					>
						{link
							? (link.projectName ?? link.projectId)
							: t('settings:repo.infisical.summary.none', 'No project linked')}
					</span>
					<LinkStateBadge link={link} />
				</div>
				<p className='truncate text-muted-foreground text-xxs'>
					{link ? (
						<SummaryDetail link={link} />
					) : (
						t(
							'settings:repo.infisical.summary.none-detail',
							'Pick a project below to resolve its secrets into every workspace, terminal, and agent.',
						)
					)}
				</p>
			</div>
			{link ? (
				<div className='flex shrink-0 items-center gap-1.5'>
					{showsSync ? (
						<Button
							disabled={!canOperate || syncing}
							onClick={onSync}
							size='sm'
							type='button'
							variant='outline'
						>
							<RefreshCwIcon
								aria-hidden='true'
								className={cn(syncing && 'animate-spin')}
								data-icon='inline-start'
							/>
							{syncing
								? t('settings:repo.infisical.syncing', 'Syncing…')
								: t('settings:repo.infisical.sync', 'Sync now')}
						</Button>
					) : null}
					{/* Unlinking rewrites the committed `.ensemblr/settings.toml` for
					    everyone who clones the repository, which is too much to hang off
					    one stray click. */}
					<ConfirmDestructiveButton
						armedLabel={t(
							'settings:repo.infisical.unlink-confirm',
							'Confirm unlink',
						)}
						disabled={unlinking}
						label={t('settings:repo.infisical.unlink', 'Unlink')}
						onConfirm={onUnlink}
						size='sm'
					/>
				</div>
			) : null}
		</div>
	);
}

/** Metadata line under the project name: account, environment, path, and last sync. */
function SummaryDetail({ link }: { link: InfisicalLinkSnapshot }) {
	const { i18n, t } = useTranslation();
	const parts = [
		link.accountLabel,
		link.environmentSlug,
		displaySecretPath(link.secretPath, link.recursive),
		link.lastSyncedAt
			? t('settings:repo.infisical.summary.synced-at', 'synced {{when}}', {
					when: formatSyncTimestamp(link.lastSyncedAt, i18n.language),
				})
			: t('settings:repo.infisical.summary.never-synced', 'never synced'),
	].filter((part): part is string => Boolean(part));

	return <>{parts.join(' · ')}</>;
}

/**
 * Renders the read scope as one path token, using the glob a developer already
 * reads as "and everything under here" rather than a second badge.
 * @param secretPath - Folder the link reads.
 * @param recursive - Whether nested folders are read too.
 * @returns The path as shown in the summary line.
 */
function displaySecretPath(secretPath: string, recursive: boolean): string {
	if (!recursive) {
		return secretPath;
	}

	/* i18next-instrument-ignore */
	return secretPath === '/' ? '/**' : `${secretPath}/**`;
}

/** Reports how complete the link is: resolvable, discovered, missing its account half, or absent. */
function LinkStateBadge({ link }: { link: InfisicalLinkSnapshot | null }) {
	const { t } = useTranslation();

	if (!link) {
		return (
			<StatusBadge tone='muted'>
				{t('settings:repo.infisical.summary.state-none', 'Not linked')}
			</StatusBadge>
		);
	}

	if (link.origin === 'infisical-cli') {
		return (
			<StatusBadge tone='info'>
				{t('settings:repo.infisical.summary.state-detected', 'Detected')}
			</StatusBadge>
		);
	}

	if (!link.accountId) {
		return (
			<StatusBadge tone='warning'>
				{t('settings:repo.infisical.summary.state-pending', 'Not saved yet')}
			</StatusBadge>
		);
	}

	return (
		<StatusBadge tone='ok'>
			{t('settings:repo.infisical.summary.state-linked', 'Linked')}
		</StatusBadge>
	);
}

/**
 * Formats a sync timestamp in the active UI language, at the precision the line
 * needs — the exact second the old raw `toLocaleString()` printed was noise.
 * @param iso - ISO timestamp of the last successful sync.
 * @param locale - BCP-47 tag of the active UI language.
 * @returns The localized date and time, or the raw value when it cannot be parsed.
 */
function formatSyncTimestamp(iso: string, locale: string): string {
	const parsed = Date.parse(iso);

	if (Number.isNaN(parsed)) {
		return iso;
	}

	return new Intl.DateTimeFormat(locale, {
		dateStyle: 'medium',
		timeStyle: 'short',
	}).format(parsed);
}
