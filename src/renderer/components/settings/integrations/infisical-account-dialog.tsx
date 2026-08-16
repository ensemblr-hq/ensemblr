import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	addInfisicalAccount,
	ensemblrQueryKeys,
	unexpectedFailure,
} from '@/renderer/api/ensemblr';
import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { failureText } from '@/renderer/lib/failure-text';

/** Infisical Cloud's two regions, offered as one-click instance URLs. */
const INFISICAL_REGIONS = [
	/* i18next-instrument-ignore */
	{ label: 'Infisical Cloud (US)', url: 'https://app.infisical.com' },
	/* i18next-instrument-ignore */
	{ label: 'Infisical Cloud (EU)', url: 'https://eu.infisical.com' },
] as const;

/**
 * Dialog that adds one Infisical account from a Machine Identity's Client ID
 * and Client Secret. The secret is sent to the main process once and stored in
 * the Keychain; it is never read back into the renderer.
 */
export function InfisicalAccountDialog({
	onOpenChange,
	open,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const [label, setLabel] = useState('');
	const [siteUrl, setSiteUrl] = useState<string>(INFISICAL_REGIONS[0].url);
	const [clientId, setClientId] = useState('');
	const [clientSecret, setClientSecret] = useState('');
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const add = useMutation({
		mutationFn: addInfisicalAccount,
		onError: (error) =>
			setErrorMessage(failureText(t, unexpectedFailure(error))),
		onSuccess: async (result) => {
			if (result.failure) {
				setErrorMessage(failureText(t, result.failure));
				return;
			}

			await queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.infisicalAccounts(),
			});
			onOpenChange(false);
			setLabel('');
			setClientId('');
			setClientSecret('');
			setErrorMessage(null);
		},
	});

	const canSubmit = Boolean(clientId.trim() && clientSecret.trim() && siteUrl);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='sm:max-w-lg'>
				<DialogHeader>
					<DialogTitle>
						{t(
							'settings:integrations.infisical.add-title',
							'Add an Infisical account',
						)}
					</DialogTitle>
					<DialogDescription>
						{t(
							'settings:integrations.infisical.add-description',
							'Create a Machine Identity in Infisical under Organization Access Control, give it access to the projects you want, then paste its Universal Auth credentials here. The Client Secret is stored in the macOS Keychain.',
						)}
					</DialogDescription>
				</DialogHeader>

				<div className='space-y-4'>
					<div className='space-y-1.5'>
						<Label htmlFor='infisical-label'>
							{t('settings:integrations.infisical.label-field', 'Name')}
						</Label>
						<Input
							id='infisical-label'
							onChange={(event) => setLabel(event.target.value)}
							placeholder={t(
								'settings:integrations.infisical.label-placeholder',
								'Work org',
							)}
							value={label}
						/>
					</div>

					<div className='space-y-1.5'>
						<Label htmlFor='infisical-site-url'>
							{t('settings:integrations.infisical.site-url', 'Instance URL')}
						</Label>
						<Input
							id='infisical-site-url'
							onChange={(event) => setSiteUrl(event.target.value)}
							value={siteUrl}
						/>
						<div className='flex flex-wrap gap-2 pt-1'>
							{INFISICAL_REGIONS.map((region) => (
								<Button
									key={region.url}
									onClick={() => setSiteUrl(region.url)}
									size='sm'
									type='button'
									variant='outline'
								>
									{/* i18next-instrument-ignore */}
									{region.label}
								</Button>
							))}
						</div>
					</div>

					<div className='space-y-1.5'>
						<Label htmlFor='infisical-client-id'>
							{t('settings:integrations.infisical.client-id', 'Client ID')}
						</Label>
						<Input
							autoComplete='off'
							id='infisical-client-id'
							onChange={(event) => setClientId(event.target.value)}
							value={clientId}
						/>
					</div>

					<div className='space-y-1.5'>
						<Label htmlFor='infisical-client-secret'>
							{t(
								'settings:integrations.infisical.client-secret',
								'Client Secret',
							)}
						</Label>
						<Input
							autoComplete='off'
							id='infisical-client-secret'
							onChange={(event) => setClientSecret(event.target.value)}
							type='password'
							value={clientSecret}
						/>
					</div>

					{errorMessage ? (
						<p className='text-status-danger text-xs'>{errorMessage}</p>
					) : null}
				</div>

				<DialogFooter>
					<Button
						onClick={() => onOpenChange(false)}
						type='button'
						variant='ghost'
					>
						{t('common:actions.cancel', 'Cancel')}
					</Button>
					<Button
						disabled={!canSubmit || add.isPending}
						onClick={() =>
							add.mutate({ clientId, clientSecret, label, siteUrl })
						}
						type='button'
					>
						{add.isPending
							? t('settings:integrations.infisical.adding', 'Connecting…')
							: t('settings:integrations.infisical.add-submit', 'Add account')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
