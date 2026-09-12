import {
	type UseQueryResult,
	useMutation,
	useQueryClient,
} from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	applySettingsPublication,
	cleanupSettingsPublication,
	settingsPublicationRecoveryStatusQuery,
} from '@/renderer/api/ensemblr';
import { unexpectedPublicationFailure } from '@/renderer/components/settings/repo-publication/publication-failure';
import type { CodedFailure } from '@/renderer/lib/failure-text';
import type { PreviewSettingsPublicationResult } from '@/shared/ipc/contracts/settings-publication';

/**
 * Owns the apply/cleanup mutation state for one repository's publication
 * screen — the last failure or recovery id each produced, and the two
 * mutations that write them. Both mutations refetch the preview and
 * invalidate the recovery list on completion, since either write can change
 * what both should show next.
 * @param repoId - Repository whose root clone is being published.
 * @param selectedWorkspaceId - Live workspace the publication targets.
 * @param previewQuery - The preview query this screen already runs, refetched after either mutation.
 * @returns The apply and cleanup mutations, plus the failure/recovery state they produce.
 */
export function useSettingsPublication(
	repoId: string,
	selectedWorkspaceId: string | undefined,
	previewQuery: UseQueryResult<PreviewSettingsPublicationResult>,
) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const [applyFailure, setApplyFailure] = useState<CodedFailure | null>(null);
	const [cleanupFailure, setCleanupFailure] = useState<CodedFailure | null>(
		null,
	);
	const [recoveryId, setRecoveryId] = useState<string | null>(null);
	const [cleaned, setCleaned] = useState(false);

	const invalidateRecoveries = () =>
		queryClient.invalidateQueries({
			queryKey: settingsPublicationRecoveryStatusQuery(repoId).queryKey,
		});

	const apply = useMutation({
		mutationFn: (previewToken: string) =>
			applySettingsPublication({
				previewToken,
				repositoryId: repoId,
				workspaceId: selectedWorkspaceId ?? '',
			}),
		onError: () => setApplyFailure(unexpectedPublicationFailure(t)),
		onSuccess: async (result) => {
			if (result.status === 'applied') {
				setApplyFailure(null);
				setCleanupFailure(null);
				setCleaned(false);
				setRecoveryId(result.recoveryId);
			} else {
				setApplyFailure(result.failure);
			}

			await Promise.all([invalidateRecoveries(), previewQuery.refetch()]);
		},
	});

	const cleanup = useMutation({
		mutationFn: (id: string) => cleanupSettingsPublication({ recoveryId: id }),
		onError: () => setCleanupFailure(unexpectedPublicationFailure(t)),
		onSuccess: async (result) => {
			setCleanupFailure(result.status === 'cleaned' ? null : result.failure);
			setCleaned(result.status === 'cleaned');
			await Promise.all([invalidateRecoveries(), previewQuery.refetch()]);
		},
	});

	return { apply, applyFailure, cleaned, cleanup, cleanupFailure, recoveryId };
}

const APPLY_RETRY_CODES: ReadonlySet<string> = new Set([
	'preview-stale',
	'preview-not-found',
	'destination-changed',
	'source-changed',
]);

/**
 * Resolves the failed-apply hint's translation key, matching what the backend
 * actually did rather than assuming nothing was written. Only a stale preview
 * is safely retried as-is; a `write-failed` apply already replaced the
 * workspace file and needs the recovery snapshot, not a retry; every other
 * code gets no hint, since none of them describe a changed file.
 * @param code - The failed apply's code, or undefined when there was no failure.
 * @param t - Translation function.
 * @returns The hint text to render, or null when no hint applies.
 */
export function applyHint(
	code: string | undefined,
	t: TFunction,
): string | null {
	if (code && APPLY_RETRY_CODES.has(code)) {
		return t(
			'settings:repo.publication.apply.retry',
			'Nothing was written. One of the two files changed while the preview was open, so it has been read again — check it and publish once more.',
		);
	}
	if (code === 'write-failed') {
		return t(
			'settings:repo.publication.apply.write-unverified',
			'The workspace file was replaced, but the write could not be verified. Use the recovery snapshot below to put it back, then publish again.',
		);
	}
	return null;
}
