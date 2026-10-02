import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { CheckIcon, PlusIcon, RefreshCwIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	ensemblrQueryKeys,
	infisicalAccountsQuery,
	removeInfisicalAccount,
	testInfisicalAccount,
	unexpectedFailure,
} from '@/renderer/api/ensemblr';
import { ConfirmDestructiveButton } from '@/renderer/components/settings/confirm-destructive-button';
import { InfisicalAccountDialog } from '@/renderer/components/settings/integrations/infisical-account-dialog';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { InfisicalLogo } from '@/renderer/components/workbench-shell/source-provider-logo';
import { failureText } from '@/renderer/lib/failure-text';
import { cn } from '@/renderer/lib/utils';
import type { InfisicalAccountSnapshot } from '@/shared/ipc/contracts/infisical';

/**
 * Settings row listing every configured Infisical account, with add, re-check,
 * and remove. Several accounts are the norm — cloud US, cloud EU, a self-hosted
 * instance — so this is a list rather than a single connect button.
 */
export function InfisicalAccountsRow() {
	const { t } = useTranslation();
	const [dialogOpen, setDialogOpen] = useState(false);
	const { data, isLoading } = useQuery(infisicalAccountsQuery);
	const accounts = data?.accounts ?? [];

	return (
		<SettingRow
			control={
				<Button
					onClick={() => setDialogOpen(true)}
					size='sm'
					type='button'
					variant='outline'
				>
					<PlusIcon aria-hidden='true' className='size-3.5' />
					{t('settings:integrations.infisical.add', 'Add account')}
				</Button>
			}
			description={t(
				'settings:integrations.infisical.description',
				'Machine Identities Ensemblr uses to read secrets from Infisical. Add one per organization or instance; each Client Secret is stored in the macOS Keychain.',
			)}
			label={
				/* i18next-instrument-ignore */
				<span className='flex items-center gap-2'>
					<InfisicalLogo className='size-4' />
					Infisical
				</span>
			}
		>
			{isLoading ? (
				<p className='text-muted-foreground text-xs'>
					{t(
						'settings:integrations.infisical.loading',
						'Loading Infisical accounts…',
					)}
				</p>
			) : null}

			{!isLoading && accounts.length === 0 ? (
				<p className='text-muted-foreground text-xs'>
					{t(
						'settings:integrations.infisical.empty',
						'No Infisical accounts yet. Add one to link a repository to a project.',
					)}
				</p>
			) : null}

			{accounts.length > 0 ? (
				<ul className='divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/40'>
					{accounts.map((account) => (
						<InfisicalAccountItem account={account} key={account.id} />
					))}
				</ul>
			) : null}

			<InfisicalAccountDialog onOpenChange={setDialogOpen} open={dialogOpen} />
		</SettingRow>
	);
}

/** How long a successful re-check keeps showing its confirmation tick. */
const VERIFIED_FLASH_MS = 4000;

/** One configured account, with its verification state and per-account actions. */
function InfisicalAccountItem({
	account,
}: {
	account: InfisicalAccountSnapshot;
}) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const [failureMessage, setFailureMessage] = useState<string | null>(null);
	const [justVerified, setJustVerified] = useState(false);

	/** Refreshes the account list after a mutation settles. */
	const invalidateAccounts = () =>
		queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.infisicalAccounts(),
		});

	const test = useMutation({
		mutationFn: () => testInfisicalAccount(account.id),
		onError: (error) =>
			setFailureMessage(failureText(t, unexpectedFailure(error))),
		onSuccess: async (result) => {
			setFailureMessage(failureText(t, result.failure));
			setJustVerified(!result.failure);
			await invalidateAccounts();
		},
	});

	const remove = useMutation({
		mutationFn: () => removeInfisicalAccount(account.id),
		onError: (error) =>
			setFailureMessage(failureText(t, unexpectedFailure(error))),
		onSuccess: async (result) => {
			setFailureMessage(failureText(t, result.failure));
			await invalidateAccounts();
		},
	});

	useEffect(() => {
		if (!justVerified) {
			return;
		}

		const timer = window.setTimeout(
			() => setJustVerified(false),
			VERIFIED_FLASH_MS,
		);
		return () => window.clearTimeout(timer);
	}, [justVerified]);

	return (
		<li className='px-3 py-2.5 transition-colors hover:bg-muted/30'>
			<div className='flex items-center gap-3'>
				<div className='min-w-0 flex-1 space-y-1'>
					<div className='flex min-w-0 items-center gap-2'>
						<span className='truncate font-medium text-foreground text-sm'>
							{account.label}
						</span>
						<InfisicalAccountBadge account={account} />
					</div>
					<p className='truncate font-mono text-muted-foreground text-xxs'>
						{displaySiteUrl(account.siteUrl)} · {account.clientId}
						{account.maskedClientSecret
							? ` · ${account.maskedClientSecret}`
							: ''}
					</p>
				</div>
				<div className='flex shrink-0 items-center gap-1.5'>
					<Button
						disabled={test.isPending}
						onClick={() => test.mutate()}
						size='xs'
						type='button'
						variant='outline'
					>
						{justVerified && !test.isPending ? (
							<CheckIcon
								aria-hidden='true'
								className='text-status-ok'
								data-icon='inline-start'
							/>
						) : (
							<RefreshCwIcon
								aria-hidden='true'
								className={cn(test.isPending && 'animate-spin')}
								data-icon='inline-start'
							/>
						)}
						{t('settings:integrations.infisical.test', 'Re-check')}
					</Button>
					{/* Removing an account deletes its Client Secret from the Keychain,
					    and Infisical shows a Universal Auth secret exactly once — so
					    there is no undo short of minting a new Machine Identity. */}
					<ConfirmDestructiveButton
						armedLabel={t(
							'settings:integrations.infisical.remove-confirm',
							'Confirm remove',
						)}
						disabled={remove.isPending}
						label={t('common:actions.remove', 'Remove')}
						onConfirm={() => remove.mutate()}
						size='xs'
					/>
				</div>
			</div>
			<p className='sr-only' role='status'>
				{recheckStatusText(t, test.isPending, justVerified)}
			</p>
			{failureMessage ? (
				<p className='pt-1.5 text-status-danger text-xs'>{failureMessage}</p>
			) : null}
		</li>
	);
}

/**
 * Announcement for the re-check button's current state. The visible signal is
 * an icon swap inside a fixed-width button so the row never reflows; this
 * carries the same information for assistive tech.
 * @param t - Translation function from `useTranslation`
 * @param isChecking - Whether a re-check is in flight
 * @param isVerified - Whether the last re-check just succeeded
 * @returns The status sentence, or an empty string when there is nothing to announce
 */
function recheckStatusText(
	t: TFunction,
	isChecking: boolean,
	isVerified: boolean,
): string {
	if (isChecking) {
		return t('settings:integrations.infisical.testing', 'Checking…');
	}

	if (isVerified) {
		return t('settings:integrations.infisical.verified', 'Credentials work.');
	}

	return '';
}

/**
 * Shortens an instance URL for the metadata line. The default `https://` is
 * noise, but `http://` stays visible because a plaintext instance is worth
 * noticing at a glance.
 * @param siteUrl - Instance URL as stored on the account
 * @returns The URL without a redundant https scheme or trailing slash
 */
function displaySiteUrl(siteUrl: string): string {
	return siteUrl.replace(/^https:\/\//, '').replace(/\/+$/, '');
}

/** Badge reporting whether an account's stored credentials last worked. */
function InfisicalAccountBadge({
	account,
}: {
	account: InfisicalAccountSnapshot;
}) {
	const { t } = useTranslation();

	if (account.lastErrorCode) {
		return (
			<Badge variant='destructive'>
				{t('settings:integrations.infisical.state-error', 'Not working')}
			</Badge>
		);
	}

	if (account.lastVerifiedAt) {
		return (
			<Badge variant='secondary'>
				{t('settings:integrations.infisical.state-connected', 'Connected')}
			</Badge>
		);
	}

	return (
		<Badge variant='outline'>
			{t('settings:integrations.infisical.state-unverified', 'Not checked')}
		</Badge>
	);
}
