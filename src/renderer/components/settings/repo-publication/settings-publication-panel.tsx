import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { previewSettingsPublication } from '@/renderer/api/ensemblr';
import { ensemblrQueryKeys } from '@/renderer/api/ensemblr/query-keys';
import { ConfirmDestructiveButton } from '@/renderer/components/settings/confirm-destructive-button';
import { PublicationPreview } from '@/renderer/components/settings/repo-publication/publication-preview';
import { PublicationRecoveryList } from '@/renderer/components/settings/repo-publication/publication-recovery-list';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import {
	SettingsErrorState,
	SettingsLoadingState,
} from '@/renderer/components/settings/settings-async-state';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { SettingsWorkspaceTargetRow } from '@/renderer/components/settings/settings-workspace-target-row';
import {
	applyHint,
	useSettingsPublication,
} from '@/renderer/hooks/use-settings-publication';
import { useSettingsWorkspaceTarget } from '@/renderer/hooks/use-settings-workspace-target';
import { type CodedFailure, failureText } from '@/renderer/lib/failure-text';
import type { PreviewSettingsPublicationResult } from '@/shared/ipc/contracts/settings-publication';

/**
 * The section's own heading and intro, reused by every state the panel can be
 * in so the screen keeps its title while it loads or reports an empty root.
 */
function PublicationSection({ children }: { children: ReactNode }) {
	const { t } = useTranslation();

	return (
		<SettingsSection
			description={t(
				'settings:repo.publication.description',
				'Shared repository settings that were written into the root clone sit on no branch and in no diff. Publishing merges them into a live workspace’s committed .ensemblr/settings.toml, where they can be reviewed and committed like any other change.',
			)}
			title={t('settings:repo.publication.title', 'Settings file')}
		>
			{children}
		</SettingsSection>
	);
}

/**
 * The one-click-armed removal of the root clone's copy, offered only after a
 * publication this session produced a recovery record. Separate from the apply
 * action on purpose: the publication is reversible from a snapshot, and this
 * step is the one that changes the root checkout.
 */
function RootCleanupRow({
	failure,
	onCleanup,
	pending,
	succeeded,
}: {
	/** Failure from the last cleanup attempt, if it failed. */
	failure: CodedFailure | null;
	onCleanup: () => void;
	pending: boolean;
	/** True once the root copy has been restored to its committed state. */
	succeeded: boolean;
}) {
	const { t } = useTranslation();
	const message = failureText(t, failure);

	return (
		<SettingRow
			control={
				succeeded ? null : (
					<ConfirmDestructiveButton
						armedLabel={t(
							'settings:repo.publication.cleanup.armed',
							'Remove it',
						)}
						disabled={pending}
						label={t(
							'settings:repo.publication.cleanup.action',
							'Remove root copy',
						)}
						onConfirm={onCleanup}
						size='sm'
					/>
				)
			}
			description={
				succeeded
					? t(
							'settings:repo.publication.cleanup.done',
							'The root clone’s file is back to its committed state.',
						)
					: t(
							'settings:repo.publication.cleanup.description',
							'Restores the root clone’s file to its committed HEAD state. A recovery snapshot is kept either way, so this can be put back.',
						)
			}
			label={t(
				'settings:repo.publication.cleanup.label',
				'Remove the root copy',
			)}
		>
			{message ? (
				<div className='space-y-1'>
					<SettingsErrorState className='py-2' message={message} />
					{failure?.code === 'cleanup-unsafe' ? (
						<p className='text-muted-foreground text-xs leading-relaxed'>
							{t(
								'settings:repo.publication.cleanup.unsafe-hint',
								'The root clone’s file is staged or conflicted. Settle it in git first — retrying will not clear this.',
							)}
						</p>
					) : null}
				</div>
			) : null}
		</SettingRow>
	);
}

/**
 * The preview, apply-outcome, and root-cleanup states that follow choosing a
 * publication target. Split out from `SettingsPublicationPanel` purely to
 * keep that component's conditional-render chain readable; it owns no state
 * of its own beyond what its props hand it.
 */
function PublicationResults({
	previewQuery,
	publication,
}: {
	previewQuery: UseQueryResult<PreviewSettingsPublicationResult>;
	publication: ReturnType<typeof useSettingsPublication>;
}) {
	const { t } = useTranslation();
	const { apply, applyFailure, cleaned, cleanup, cleanupFailure, recoveryId } =
		publication;
	const preview = previewQuery.data?.preview ?? null;
	const previewFailure = previewQuery.data?.failure ?? null;
	const isEmptyRoot = previewFailure?.code === 'source-missing';
	const previewMessage = isEmptyRoot ? null : failureText(t, previewFailure);
	const applyMessage = failureText(t, applyFailure);
	const applyHintText = applyHint(applyFailure?.code, t);

	return (
		<>
			{previewQuery.isFetching && !preview ? (
				<SettingsLoadingState
					label={t(
						'settings:repo.publication.loading',
						'Reading the root clone…',
					)}
				/>
			) : null}

			{isEmptyRoot ? (
				<p className='py-4 text-muted-foreground text-xs'>
					{t(
						'settings:repo.publication.empty',
						'The root clone holds no unpublished settings.',
					)}
				</p>
			) : null}

			{previewMessage ? <SettingsErrorState message={previewMessage} /> : null}

			{preview ? (
				<PublicationPreview
					onApply={() => apply.mutate(preview.token)}
					pending={apply.isPending}
					preview={preview}
				/>
			) : null}

			{applyMessage ? (
				<div className='space-y-1 py-2'>
					<SettingsErrorState className='py-2' message={applyMessage} />
					{applyHintText ? (
						<p className='text-muted-foreground text-xs leading-relaxed'>
							{applyHintText}
						</p>
					) : null}
				</div>
			) : null}

			{recoveryId ? (
				<p className='py-4 text-muted-foreground text-xs'>
					{t(
						'settings:repo.publication.applied',
						'Published. The workspace’s branch now carries the settings, and the root clone still holds its own copy.',
					)}
				</p>
			) : null}

			{recoveryId ? (
				<RootCleanupRow
					failure={cleanupFailure}
					onCleanup={() => cleanup.mutate(recoveryId)}
					pending={cleanup.isPending}
					succeeded={cleaned}
				/>
			) : null}
		</>
	);
}

/**
 * Moves the repository settings stranded in the root clone onto a live
 * workspace's branch: preview a native three-way merge, publish a clean one,
 * and — as a separately confirmed step — drop the root copy afterwards.
 */
export function SettingsPublicationPanel({ repoId }: { repoId: string }) {
	const { t } = useTranslation();
	const { selectWorkspace, selectedWorkspaceId, workspaces } =
		useSettingsWorkspaceTarget(repoId);

	const previewQuery = useQuery({
		enabled: Boolean(selectedWorkspaceId),
		queryFn: () =>
			previewSettingsPublication({
				repositoryId: repoId,
				workspaceId: selectedWorkspaceId ?? '',
			}),
		queryKey: ensemblrQueryKeys.settingsPublicationPreview(
			repoId,
			selectedWorkspaceId,
		),
		refetchOnMount: false,
		refetchOnReconnect: false,
		refetchOnWindowFocus: false,
	});

	const publication = useSettingsPublication(
		repoId,
		selectedWorkspaceId,
		previewQuery,
	);

	if (workspaces.length === 0) {
		return (
			<PublicationSection>
				<p className='py-4 text-muted-foreground text-xs'>
					{t(
						'settings:repo.publication.no-workspace',
						'Settings are published onto a live workspace’s branch. Open a workspace for this repository first.',
					)}
				</p>
			</PublicationSection>
		);
	}

	return (
		<PublicationSection>
			<SettingsWorkspaceTargetRow
				description={t(
					'settings:repo.publication.workspace-target.description',
					'The merged file is written on this workspace’s branch, the same as any other commit.',
				)}
				label={t(
					'settings:repo.publication.workspace-target.label',
					'Publish to workspace',
				)}
				onChange={selectWorkspace}
				value={selectedWorkspaceId}
				workspaces={workspaces}
			/>

			<PublicationResults
				previewQuery={previewQuery}
				publication={publication}
			/>

			<PublicationRecoveryList repositoryId={repoId} workspaces={workspaces} />
		</PublicationSection>
	);
}
