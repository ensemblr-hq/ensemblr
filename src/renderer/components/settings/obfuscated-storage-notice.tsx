import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheckIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
	acknowledgeObfuscatedStorage,
	ensemblrQueryKeys,
	obfuscatedStorageStatusQuery,
} from '@/renderer/api/ensemblr';
import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';

/**
 * Warns when the session's keyring only obfuscates stored secrets rather than
 * encrypting them, and offers the one acknowledgement that unblocks writing
 * secrets under it.
 *
 * Renders nothing on macOS and on any Linux session with a real keyring
 * daemon — {@link obfuscatedStorageStatusQuery}'s `isObfuscated` is only true
 * behind Electron's `basic_text` fallback. Once acknowledged it keeps showing
 * a quiet confirmation rather than disappearing, because the underlying
 * weaker guarantee is still in effect for as long as this backend is selected.
 */
export function ObfuscatedStorageNotice() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const { data: status } = useQuery(obfuscatedStorageStatusQuery);

	const acknowledge = useMutation({
		mutationFn: acknowledgeObfuscatedStorage,
		onSuccess: (next) => {
			queryClient.setQueryData(
				ensemblrQueryKeys.obfuscatedStorageStatus(),
				next,
			);
		},
	});

	if (!status?.isObfuscated) {
		return null;
	}

	if (status.acknowledged) {
		return (
			<div className='flex items-start gap-2 rounded-xl border border-muted-foreground/20 bg-muted/40 px-4 py-3 text-muted-foreground text-xs'>
				<ShieldCheckIcon
					aria-hidden='true'
					className='mt-0.5 size-4 shrink-0'
				/>
				<p>
					{t(
						'settings:diagnostics.obfuscated-storage.acknowledged',
						'You accepted that the {{backend}} backend only obfuscates stored secrets on this machine, not encrypts them.',
						{ backend: status.backend },
					)}
				</p>
			</div>
		);
	}

	return (
		<div className='flex flex-col items-start gap-2 rounded-xl border border-status-warning/30 bg-status-warning/10 px-4 py-3'>
			<p className='flex items-center gap-2 font-medium text-sm text-status-warning'>
				<TriangleAlertIcon aria-hidden='true' className='size-4 shrink-0' />
				{t(
					'settings:diagnostics.obfuscated-storage.title',
					'Secrets are only obfuscated, not encrypted',
				)}
			</p>
			<p className='max-w-prose text-pretty text-muted-foreground text-xs'>
				{t(
					'settings:diagnostics.obfuscated-storage.description',
					'No keyring daemon answered, so Ensemblr falls back to the {{backend}} backend, which obfuscates stored secrets with a key published in its own source rather than encrypting them. Anyone who can read the local database file can recover them. Start gnome-keyring or KWallet for real encryption, or accept the weaker protection to keep using secrets on this machine.',
					{ backend: status.backend },
				)}
			</p>
			<Button
				disabled={acknowledge.isPending}
				onClick={() => acknowledge.mutate()}
				size='sm'
				variant='outline'
			>
				{acknowledge.isPending ? (
					<Spinner className='size-4' />
				) : (
					<ShieldCheckIcon aria-hidden='true' className='size-4' />
				)}
				{t(
					'settings:diagnostics.obfuscated-storage.acknowledge',
					'Accept and store secrets anyway',
				)}
			</Button>
			{acknowledge.isError ? (
				<p className='text-status-danger text-xs'>
					{t(
						'settings:diagnostics.obfuscated-storage.acknowledge-failed',
						'Could not record the acknowledgement: {{error}}.',
						{
							error:
								acknowledge.error instanceof Error
									? acknowledge.error.message
									: String(acknowledge.error),
						},
					)}
				</p>
			) : null}
		</div>
	);
}
