import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	restoreSettingsPublication,
	settingsPublicationRecoveryStatusQuery,
} from '@/renderer/api/ensemblr';
import { ConfirmDestructiveButton } from '@/renderer/components/settings/confirm-destructive-button';
import { unexpectedPublicationFailure } from '@/renderer/components/settings/repo-publication/publication-failure';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import {
	SettingsErrorState,
	SettingsLoadingState,
} from '@/renderer/components/settings/settings-async-state';
import { type CodedFailure, failureText } from '@/renderer/lib/failure-text';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { SettingsPublicationRecoverySnapshot } from '@/shared/ipc/contracts/settings-publication';

/**
 * Formats a snapshot timestamp at the precision the row needs, matching the
 * other repository settings surfaces rather than printing a raw ISO string.
 * @param iso - ISO timestamp captured with the snapshot.
 * @param locale - BCP-47 tag of the active UI language.
 * @returns The localized date and time, or the raw value when it cannot be parsed.
 */
function formatSnapshotTimestamp(iso: string, locale: string): string {
	const parsed = Date.parse(iso);

	if (Number.isNaN(parsed)) {
		return iso;
	}

	return new Intl.DateTimeFormat(locale, {
		dateStyle: 'medium',
		timeStyle: 'short',
	}).format(parsed);
}

/**
 * One captured publication, with the two sides it can put back. Restoring the
 * root copy only says anything once the root copy has actually been removed, so
 * that control stays disabled until then.
 */
function RecoveryRow({
	onRestore,
	pending,
	record,
	workspaceName,
}: {
	/** Restores one captured side of this record. */
	onRestore: (copy: 'destination' | 'source') => void;
	/** True while a restore of this record is in flight. */
	pending: boolean;
	record: SettingsPublicationRecoverySnapshot;
	workspaceName: string;
}) {
	const { i18n, t } = useTranslation();
	const appliedLabel = record.appliedAt
		? t('settings:repo.publication.recovery.applied-at', 'Published {{when}}', {
				when: formatSnapshotTimestamp(record.appliedAt, i18n.language),
			})
		: t('settings:repo.publication.recovery.not-applied', 'Not published');
	const cleanedLabel = record.cleanedAt
		? t(
				'settings:repo.publication.recovery.cleaned-at',
				'Root copy removed {{when}}',
				{ when: formatSnapshotTimestamp(record.cleanedAt, i18n.language) },
			)
		: t(
				'settings:repo.publication.recovery.not-cleaned',
				'Root copy still present',
			);

	return (
		<SettingRow
			control={
				<>
					<ConfirmDestructiveButton
						armedLabel={t(
							'settings:repo.publication.recovery.restore-armed',
							'Restore it',
						)}
						disabled={pending || !record.appliedAt}
						label={t(
							'settings:repo.publication.recovery.restore-destination',
							'Restore workspace file',
						)}
						onConfirm={() => onRestore('destination')}
						size='xs'
					/>
					<ConfirmDestructiveButton
						armedLabel={t(
							'settings:repo.publication.recovery.restore-armed',
							'Restore it',
						)}
						disabled={pending || !record.cleanedAt}
						label={t(
							'settings:repo.publication.recovery.restore-source',
							'Restore root file',
						)}
						onConfirm={() => onRestore('source')}
						size='xs'
					/>
				</>
			}
			description={appliedLabel}
			label={workspaceName}
		>
			<p className='text-muted-foreground text-xs leading-relaxed'>
				{cleanedLabel}
			</p>
		</SettingRow>
	);
}

/**
 * The durable snapshots taken around each publication, newest first. Each one
 * can put back the workspace file as it stood before the publication, or the
 * root file as it stood before its cleanup.
 */
export function PublicationRecoveryList({
	repositoryId,
	workspaces,
}: {
	repositoryId: string;
	/** Live workspaces, used to name the workspace a snapshot belongs to. */
	workspaces: WorkspaceShellModel[];
}) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const [restoreFailure, setRestoreFailure] = useState<CodedFailure | null>(
		null,
	);
	const recoveryQuery = useQuery(
		settingsPublicationRecoveryStatusQuery(repositoryId),
	);
	const restore = useMutation({
		mutationFn: (input: {
			copy: 'destination' | 'source';
			recoveryId: string;
		}) => restoreSettingsPublication(input),
		onError: () => setRestoreFailure(unexpectedPublicationFailure(t)),
		onSuccess: async (result) => {
			setRestoreFailure(result.status === 'restored' ? null : result.failure);
			await queryClient.invalidateQueries({
				queryKey: settingsPublicationRecoveryStatusQuery(repositoryId).queryKey,
			});
		},
	});

	if (recoveryQuery.isPending) {
		return (
			<SettingsLoadingState
				label={t(
					'settings:repo.publication.recovery.loading',
					'Reading recovery snapshots…',
				)}
			/>
		);
	}

	const listFailure = failureText(t, recoveryQuery.data?.failure);

	if (listFailure) {
		return <SettingsErrorState message={listFailure} />;
	}

	const recoveries = recoveryQuery.data?.recoveries ?? [];

	if (recoveries.length === 0) {
		return null;
	}

	const restoreMessage = failureText(t, restoreFailure);

	return (
		<>
			<SettingRow
				description={t(
					'settings:repo.publication.recovery.description',
					'Copies captured before each publication and before each root cleanup, so either side can be put back.',
				)}
				label={t(
					'settings:repo.publication.recovery.label',
					'Recovery snapshots',
				)}
			/>
			{recoveries.map((record) => (
				<RecoveryRow
					key={record.id}
					onRestore={(copy) => restore.mutate({ copy, recoveryId: record.id })}
					pending={
						restore.isPending && restore.variables?.recoveryId === record.id
					}
					record={record}
					workspaceName={
						workspaces.find((candidate) => candidate.id === record.workspaceId)
							?.name ??
						t(
							'settings:repo.publication.recovery.unknown-workspace',
							'Archived workspace',
						)
					}
				/>
			))}
			{restoreMessage ? <SettingsErrorState message={restoreMessage} /> : null}
		</>
	);
}
