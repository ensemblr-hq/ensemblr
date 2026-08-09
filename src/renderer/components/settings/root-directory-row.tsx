import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	ensemblrQueryKeys,
	getEnsemblrApi,
	rootDirectoryQuery,
} from '@/renderer/api/ensemblr';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsCodeValue } from '@/renderer/components/settings/settings-code-value';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import type { RootDirectoryStatus } from '@/shared/ipc/contracts/root-directory';

/**
 * Names a non-ok root-directory health status. Main returns the locale-neutral
 * code, so the badge reads it in the app language rather than showing the raw
 * value.
 * @param status - Health status the root service reported.
 * @param t - Translation function from `useTranslation`
 * @returns The badge label.
 */
function rootStatusLabel(status: RootDirectoryStatus, t: TFunction): string {
	switch (status) {
		case 'error':
			return t('settings:general.root-directory.status.error', 'error');
		case 'warning':
			return t('settings:general.root-directory.status.warning', 'warning');
		case 'ok':
			return t('settings:general.root-directory.status.ok', 'ready');
	}
}

/**
 * Settings row for the Ensemblr root directory: shows the configured path and
 * its source, and opens the picker that reconciles the repository list against
 * a newly chosen root.
 */
export function RootDirectoryRow() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const { data: rootData, isLoading: rootLoading } =
		useQuery(rootDirectoryQuery);
	const [pickError, setPickError] = useState<string | null>(null);

	const pickRoot = useMutation({
		mutationFn: async () => {
			const api = getEnsemblrApi();
			const result = await api.selectRootDirectory();
			if (result.canceled) return { applied: false as const };
			if (result.error) throw new Error(result.error);
			if (!result.preview?.canApply) return { applied: false as const };
			const apply = await api.confirmRootDirectoryChange({
				path: result.preview.newRoot.path,
			});
			if (!apply.applied) {
				throw new Error(
					apply.error ??
						t(
							'settings:general.root-directory.apply-failed',
							'Failed to apply the root directory change.',
						),
				);
			}
			return { applied: true as const };
		},
		onError: (error) =>
			setPickError(error instanceof Error ? error.message : String(error)),
		onSuccess: async (result) => {
			setPickError(null);
			if (result.applied) {
				await queryClient.invalidateQueries({
					queryKey: ensemblrQueryKeys.rootDirectory(),
				});
			}
		},
	});

	const rootStatus = rootData?.status ?? 'ok';

	return (
		<SettingRow
			control={
				<Button
					disabled={pickRoot.isPending}
					onClick={() => pickRoot.mutate()}
					size='sm'
					variant='outline'
				>
					{pickRoot.isPending
						? t('common:actions.picking', 'Picking…')
						: t('common:actions.browse', 'Browse')}
				</Button>
			}
			description={t(
				'settings:general.root-directory.description',
				'Where Ensemblr stores repositories and workspaces. This should be an empty directory you do not modify directly. Changing this will reconcile your repository list against the new root.',
			)}
			label={
				<span className='flex items-center gap-2'>
					{t(
						'settings:general.root-directory.label',
						'Ensemblr root directory',
					)}
					{rootStatus !== 'ok' ? (
						<Badge variant={rootStatus === 'error' ? 'destructive' : 'outline'}>
							{rootStatusLabel(rootStatus, t)}
						</Badge>
					) : null}
				</span>
			}
			stack
		>
			{rootLoading ? (
				<div className='flex items-center gap-2 text-muted-foreground text-xs'>
					<Spinner className='size-3.5' />
					{t('settings:general.root-directory.reading', 'Reading root…')}
				</div>
			) : (
				<SettingsCodeValue
					source={rootData?.source ?? null}
					value={
						rootData?.path ??
						t('settings:general.root-directory.unset', 'Not configured')
					}
				/>
			)}
			{pickError ? (
				<p className='mt-2 text-status-danger text-xs'>{pickError}</p>
			) : null}
		</SettingRow>
	);
}
