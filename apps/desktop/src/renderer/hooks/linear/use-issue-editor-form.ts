import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	createLinearIssue,
	ensemblrQueryKeys,
	linearMetadataQuery,
	updateLinearIssue,
} from '@/renderer/api/ensemblr';
import {
	buildCreateIssueRequest,
	buildUpdateIssueRequest,
	createIssueEditorFields,
	describeLinearFailure,
	issueEditorValidationText,
	validateIssueEditorFields,
} from '@/renderer/lib/linear';
import type { LinearIssueEditorFields } from '@/renderer/types/linear';
import type {
	LinearIssueWire,
	MutateLinearIssueResult,
} from '@/shared/ipc/contracts/linear';

/**
 * Form state behind the Linear issue editor: the edited fields, the cached
 * picker metadata, validation and save errors, and the create/update mutation.
 * The form re-seeds itself whenever the dialog opens for a different issue, so
 * one mounted dialog can serve every issue it is pointed at.
 * @param issue - Issue being edited, or undefined when creating a new one
 * @param onOpenChange - Closes the dialog once a save lands
 * @param open - Whether the dialog is open; gates the metadata query
 * @returns The fields, the picker metadata and the accounts it could not reach,
 * and the handlers the dialog binds to
 */
export function useIssueEditorForm({
	issue,
	onOpenChange,
	open,
}: {
	issue?: LinearIssueWire;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const { t } = useTranslation();
	const mode: 'create' | 'edit' = issue ? 'edit' : 'create';
	const queryClient = useQueryClient();
	const { data: metadataData } = useQuery({
		...linearMetadataQuery,
		enabled: open,
	});
	const [fields, setFields] = useState<LinearIssueEditorFields>(() =>
		createIssueEditorFields(issue),
	);
	const [error, setError] = useState<string | null>(null);

	// Re-seed the form whenever the dialog opens for a different issue.
	const [seedKey, setSeedKey] = useState(`${open}:${issue?.id ?? 'new'}`);
	const nextSeedKey = `${open}:${issue?.id ?? 'new'}`;
	if (seedKey !== nextSeedKey) {
		setSeedKey(nextSeedKey);
		setFields(createIssueEditorFields(issue));
		setError(null);
	}

	const metadata = metadataData ? metadataData.metadata : null;
	// The chosen team decides the account: a team belongs to exactly one, and
	// every other picker on the form has to narrow to the same organization.
	const accountId =
		issue?.accountId ??
		metadata?.teams.find((team) => team.id === fields.teamId)?.accountId ??
		null;

	const mutation = useMutation({
		mutationFn: async (): Promise<MutateLinearIssueResult | null> => {
			if (issue) {
				const request = buildUpdateIssueRequest(issue, fields);
				return request ? updateLinearIssue(request) : null;
			}
			return createLinearIssue(
				buildCreateIssueRequest(fields, accountId ?? undefined),
			);
		},
		onError: () => {
			setError(
				t(
					'linear:issue-editor.save-failed',
					'Saving the issue failed. Check your connection and try again.',
				),
			);
		},
		onSuccess: async (result) => {
			if (result && result.status === 'error') {
				setError(describeLinearFailure(result.failure));
				return;
			}
			// Null result means a no-op edit: nothing changed, nothing to refetch.
			if (result) {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: ensemblrQueryKeys.linearIssuesAll(),
					}),
					queryClient.invalidateQueries({
						queryKey: ensemblrQueryKeys.linearIssueAll(result.issue.id),
					}),
				]);
			}
			onOpenChange(false);
		},
	});

	return {
		accountFailures: metadataData?.accountFailures ?? [],
		accountId,
		canSubmit: validateIssueEditorFields(fields, mode).ok,
		error,
		fields,
		isSaving: mutation.isPending,
		metadata,
		mode,
		submit: () => {
			const validation = validateIssueEditorFields(fields, mode);

			if (!validation.ok) {
				setError(issueEditorValidationText(t, validation.code));
				return;
			}

			setError(null);
			mutation.mutate();
		},
		update: (patch: Partial<LinearIssueEditorFields>) => {
			setFields((current) => ({ ...current, ...patch }));
		},
	};
}
