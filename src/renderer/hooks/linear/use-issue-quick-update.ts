import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import {
	ensemblrQueryKeys,
	linearMetadataQuery,
	updateLinearIssue,
} from '@/renderer/api/ensemblr';
import { describeLinearFailure } from '@/renderer/lib/linear';
import type {
	LinearIssueFieldsInput,
	LinearIssueWire,
	LinearResourceWire,
} from '@/shared/ipc/contracts/linear';

/**
 * Narrow merged Linear metadata to the rows the issue's own account and team
 * accept. Metadata arrives merged across every connected account, and an id from
 * one organization is never valid in another — offering both would build a
 * request Linear rejects.
 * @param resources - Merged resources for one kind
 * @param issue - Issue the picker is editing
 * @returns The resources valid for this issue
 */
function scopeToIssue(
	resources: readonly LinearResourceWire[],
	issue: LinearIssueWire,
): LinearResourceWire[] {
	return resources.filter(
		(resource) =>
			resource.accountId === issue.accountId &&
			(resource.teamId === null || resource.teamId === issue.teamId),
	);
}

/**
 * Applies a single Linear field change straight from the issue page, without the
 * round trip through the editor dialog. Status, priority, and assignee are the
 * three fields a triage pass changes most, so each is one menu away; everything
 * else stays behind Edit, where validation and the multi-field form belong.
 * @param issue - Issue being edited
 * @returns The apply handler, its pending and error state, and the pickers' scoped options
 */
export function useLinearIssueQuickUpdate(issue: LinearIssueWire) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const { data: metadataData } = useQuery(linearMetadataQuery);
	const mutation = useMutation({
		mutationFn: (input: LinearIssueFieldsInput) =>
			updateLinearIssue({ id: issue.id, input }),
		onSuccess: async (result) => {
			if (result.status === 'error') {
				return;
			}
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: ensemblrQueryKeys.linearIssueAll(issue.id),
				}),
				queryClient.invalidateQueries({
					queryKey: ensemblrQueryKeys.linearIssuesAll(),
				}),
			]);
		},
	});

	const metadata = metadataData?.metadata ?? null;
	const failure =
		mutation.data?.status === 'error'
			? describeLinearFailure(mutation.data.failure)
			: mutation.error
				? t(
						'linear:issue-detail.quick-update-failed',
						'That change could not be saved to Linear.',
					)
				: null;

	return {
		apply: (input: LinearIssueFieldsInput) => mutation.mutate(input),
		error: failure,
		isSaving: mutation.isPending,
		states: metadata ? scopeToIssue(metadata.states, issue) : [],
		users: metadata
			? metadata.users.filter((user) => user.accountId === issue.accountId)
			: [],
	};
}
