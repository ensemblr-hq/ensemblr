import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
	ensemblrQueryKeys,
	getEnsemblrApi,
	rootDirectoryQuery,
} from '@/renderer/api/ensemblr';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';

/**
 * Settings row for the Ensemblr root directory: shows the configured path and
 * its source, and opens the picker that reconciles the repository list against
 * a newly chosen root.
 */
export function RootDirectoryRow() {
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
					apply.error ?? 'Failed to apply root directory change.',
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
					{pickRoot.isPending ? 'Picking…' : 'Browse'}
				</Button>
			}
			description='Where Ensemblr stores repositories and workspaces. This should be an empty directory you do not modify directly. Changing this will reconcile your repository list against the new root.'
			label={
				<span className='flex items-center gap-2'>
					Ensemblr root directory
					{rootStatus !== 'ok' ? (
						<Badge variant={rootStatus === 'error' ? 'destructive' : 'outline'}>
							{rootStatus}
						</Badge>
					) : null}
				</span>
			}
			stack
		>
			{rootLoading ? (
				<div className='mt-2 flex items-center gap-2 text-muted-foreground text-xs'>
					<Spinner className='size-3' /> Reading root…
				</div>
			) : (
				<div className='mt-2 space-y-1'>
					<code className='block truncate rounded-md bg-muted/40 px-3 py-2 font-mono text-xs'>
						{rootData?.path ?? 'Not configured'}
					</code>
					{rootData?.source ? (
						<p className='text-[0.625rem] text-muted-foreground'>
							source: {rootData.source}
						</p>
					) : null}
				</div>
			)}
			{pickError ? (
				<p className='mt-2 text-status-danger text-xs'>{pickError}</p>
			) : null}
		</SettingRow>
	);
}
