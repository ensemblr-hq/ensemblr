import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { Trash2Icon } from 'lucide-react';
import { useState } from 'react';

import {
	getEnsemblrApi,
	invalidateWorkspaceListViews,
} from '@/renderer/api/ensemblr';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Textarea } from '@/renderer/components/ui/textarea';
import { workbenchRouteApi } from '@/renderer/hooks/workbench-shell/route-layout/use-workbench-layout-model';
import { repoSettingsOverrideAtomFamily } from '@/renderer/state/preferences';

/** Route for a repository's Misc settings; renders the repo-scoped paths, preview URLs, and lifecycle panel keyed by the `repoId` path param. */
export const Route = createFileRoute('/_workbench/settings/repo/$repoId/misc')({
	component: RepoMiscSettings,
});

/** Repository-scoped Misc settings panel for root/workspace paths, preview URLs, files-to-copy globs, and repository removal. */
function RepoMiscSettings() {
	const { repoId } = Route.useParams();
	const loaderData = workbenchRouteApi.useLoaderData();
	const project = loaderData.projects.find((p) => p.id === repoId);
	const [overrides, setOverrides] = useAtom(
		repoSettingsOverrideAtomFamily(repoId),
	);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [removeError, setRemoveError] = useState<string | null>(null);

	const remove = useMutation({
		mutationFn: () =>
			getEnsemblrApi().archiveRepository({ repositoryId: repoId }),
		onSuccess: async () => {
			await invalidateWorkspaceListViews(queryClient);
			navigate({ to: '/settings/general' });
		},
		onError: (error) =>
			setRemoveError(error instanceof Error ? error.message : String(error)),
	});

	const previewUrls = overrides.previewUrls ?? [{ name: '', url: '' }];
	// previewUrls entries carry no persistent id, so track one stable key per
	// row locally. The add/remove/reset handlers below update rowIds in lockstep,
	// so removing a middle row can't shift keys and reassociate a controlled
	// <Input> to the wrong row (which positional index keys would).
	const [rowIds, setRowIds] = useState<string[]>(() =>
		previewUrls.map(() => crypto.randomUUID()),
	);

	return (
		<SettingsSection
			description='Repository paths, preview URLs, files-to-copy patterns, and lifecycle.'
			title='Misc'
		>
			<SettingRow
				description='Do not move or delete this directory. Instead, remove the repository in Ensemblr.'
				label='Root path'
				stack
			>
				<code className='mt-2 block truncate rounded-md bg-muted/40 px-3 py-2 font-mono text-xs'>
					{project?.pathLabel ?? '—'}
				</code>
			</SettingRow>

			<SettingRow
				description='Do not move or delete the workspace subdirectories. Instead, archive workspaces in Ensemblr.'
				label='Workspaces path'
				stack
			>
				<code className='mt-2 block truncate rounded-md bg-muted/40 px-3 py-2 font-mono text-xs'>
					{project ? `${project.pathLabel} (workspaces)` : '—'}
				</code>
			</SettingRow>

			<SettingRow
				description='Overrides the terminal panel’s Open button URL. Add more than one to switch between them from the Open button dropdown; the first is opened by default and the rest appear in the dropdown in order. Supports `$ENSEMBLR_WORKSPACE_NAME` and `$ENSEMBLR_PORT`. Leave blank to auto-detect from output logs.'
				label='Preview URLs'
				stack
			>
				<div className='mt-2 space-y-2'>
					{previewUrls.map((entry, idx) => {
						const rowKey = rowIds[idx];
						return (
							<div className='flex gap-2' key={rowKey}>
								<Input
									aria-label='Preview URL name'
									className='h-8 w-32 text-xs'
									onChange={(e) => {
										const next = [...previewUrls];
										next[idx] = { ...entry, name: e.target.value };
										setOverrides((prev) => ({ ...prev, previewUrls: next }));
									}}
									placeholder='Name'
									value={entry.name}
								/>
								<Input
									aria-label='Preview URL template'
									className='h-8 flex-1 font-mono text-xs'
									onChange={(e) => {
										const next = [...previewUrls];
										next[idx] = { ...entry, url: e.target.value };
										setOverrides((prev) => ({ ...prev, previewUrls: next }));
									}}
									placeholder='https://localhost:$ENSEMBLR_PORT'
									value={entry.url}
								/>
								<Button
									onClick={() => {
										const next = previewUrls.filter((_, i) => i !== idx);
										setOverrides((prev) => ({
											...prev,
											previewUrls: next.length === 0 ? undefined : next,
										}));
										setRowIds((ids) =>
											next.length === 0
												? [crypto.randomUUID()]
												: ids.filter((_, i) => i !== idx),
										);
									}}
									size='icon'
									variant='ghost'
								>
									<Trash2Icon aria-hidden='true' className='size-4' />
								</Button>
							</div>
						);
					})}
					<Button
						onClick={() => {
							setOverrides((prev) => ({
								...prev,
								previewUrls: [...previewUrls, { name: '', url: '' }],
							}));
							setRowIds((ids) => [...ids, crypto.randomUUID()]);
						}}
						size='sm'
						variant='outline'
					>
						+ Add preview URL
					</Button>
				</div>
			</SettingRow>

			<SettingRow
				description='Ensemblr will automatically copy these file paths into each new workspace. Supports gitignore-style globs.'
				label='Files to copy'
				stack
			>
				<Textarea
					aria-label='Files to copy'
					className='mt-2 min-h-18 font-mono text-xs'
					onChange={(e) =>
						setOverrides((prev) => ({ ...prev, filesToCopy: e.target.value }))
					}
					placeholder='.env*'
					value={overrides.filesToCopy ?? ''}
				/>
			</SettingRow>

			<div className='pt-6'>
				<Dialog>
					<DialogTrigger asChild>
						<Button size='sm' variant='destructive'>
							<Trash2Icon aria-hidden='true' className='size-4' />
							Remove repository
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Remove this repository?</DialogTitle>
							<DialogDescription>
								Removes the repository from Ensemblr. The on-disk directory at
								<code className='mx-1 font-mono text-xs'>
									{project?.pathLabel}
								</code>
								is not deleted; delete it manually if you want it gone.
							</DialogDescription>
						</DialogHeader>
						{removeError ? (
							<p className='text-status-danger text-xs'>{removeError}</p>
						) : null}
						<DialogFooter>
							<DialogClose asChild>
								<Button variant='ghost'>Cancel</Button>
							</DialogClose>
							<Button
								disabled={remove.isPending}
								onClick={() => remove.mutate()}
								variant='destructive'
							>
								{remove.isPending ? 'Removing…' : 'Remove'}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>
		</SettingsSection>
	);
}
