import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/renderer/components/ui/button';
import { Toaster } from '@/renderer/components/ui/sonner';
import {
	archivedWorkspaceTitle,
	reclaimedDiskDescription,
} from '@/renderer/lib/workbench';

import { SceneSection } from './scene-chrome.tsx';

/** A gigabyte-and-change, the size an archived worktree actually comes back as. */
const RECLAIMED_BYTES = 1_932_735_283;

/**
 * The archived-workspace toast, fired through the same two copy helpers the
 * shipped announcement uses, so what lands here is the announcement rather than
 * a mock-up of it.
 *
 * Two things are under review. The headline now names the workspace, because
 * archiving several in a row otherwise reports the same sentence each time and
 * the vanished sidebar row is the only other evidence. And the description takes
 * `--muted-foreground` rather than sonner's own per-theme grey, which it picked
 * from `prefers-color-scheme` — the OS scheme, not the app's — and so painted
 * near-white on a light card whenever the two disagreed. Flip the canvas theme
 * to check both cuts.
 */
export function ArchiveToastScene() {
	const { i18n: i18nInstance, t } = useTranslation();
	const description = reclaimedDiskDescription({
		bytesFreed: RECLAIMED_BYTES,
		language: i18nInstance.language,
		t,
	});

	return (
		<div className='flex flex-col gap-10'>
			<SceneSection
				label='Workspace archived'
				note='The reversible archive carries Undo in place of the confirmation it no longer asks for. The branch-dropping one cannot be reversed, so it says why instead.'
			>
				<div className='flex flex-wrap items-center gap-2'>
					<Button
						onClick={() =>
							toast.success(
								archivedWorkspaceTitle({ t, workspaceName: 'Kyriakides' }),
								{
									action: {
										label: t('common:actions.undo', 'Undo'),
										onClick: () => undefined,
									},
									description,
								},
							)
						}
						size='sm'
					>
						Named · reclaimed · Undo
					</Button>
					<Button
						onClick={() =>
							toast.success(
								archivedWorkspaceTitle({ t, workspaceName: 'Kyriakides' }),
								{
									description: t(
										'errors:workspace-archive.archived.branch-dropped',
										'Its local branch was deleted, so restoring the workspace will not bring back commits you never pushed.',
									),
								},
							)
						}
						size='sm'
						variant='outline'
					>
						Named · branch dropped
					</Button>
					<Button
						onClick={() =>
							toast.success(
								archivedWorkspaceTitle({ t, workspaceName: null }),
								{ description },
							)
						}
						size='sm'
						variant='outline'
					>
						Unnamed fallback
					</Button>
				</div>
			</SceneSection>

			<SceneSection
				label='Every toast variant'
				note='The description colour is set once for all of them, so the archive fix is only correct if the subtitle reads on every kind in both themes.'
			>
				<div className='flex flex-wrap items-center gap-2'>
					<Button
						onClick={() =>
							toast.success('Workspace archived.', { description })
						}
						size='sm'
						variant='outline'
					>
						success
					</Button>
					<Button
						onClick={() =>
							toast.info('Rebuilding dependencies.', {
								description: 'The setup script is running in the dock.',
							})
						}
						size='sm'
						variant='outline'
					>
						info
					</Button>
					<Button
						onClick={() =>
							toast.warning('The workspace was not archived.', {
								description: 'A lifecycle hook vetoed the run.',
							})
						}
						size='sm'
						variant='outline'
					>
						warning
					</Button>
					<Button
						onClick={() =>
							toast.error('Archiving the workspace failed.', {
								description: 'The worktree folder could not be removed.',
							})
						}
						size='sm'
						variant='outline'
					>
						error
					</Button>
				</div>
			</SceneSection>

			<Toaster position='bottom-right' />
		</div>
	);
}
