import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
	clearInfisicalLink,
	ensemblrQueryKeys,
	setInfisicalLink,
	syncInfisicalLink,
	unexpectedFailure,
} from '@/renderer/api/ensemblr';
import {
	EMPTY_INFISICAL_DRAFT,
	type InfisicalLinkDraft,
} from '@/renderer/components/settings/repo-infisical/infisical-link-form';
import type {
	InfisicalFailure,
	InfisicalLinkScope,
} from '@/shared/ipc/contracts/infisical';

/**
 * Owns the draft, failure, and synced-keys state for one Infisical link scope,
 * plus the save/clear/sync mutations that write it. Invalidation reaches every
 * workspace's cached link entry, not only the one being edited: the query key
 * was extended with `workspaceId`, and this hook invalidates the shared prefix
 * on purpose.
 * @param scopeRequest - Scope, id, and live workspace the link is read from and written to.
 * @returns The editable draft, the last failure or synced-key result, and the mutations that update them.
 */
export function useInfisicalLinkMutations(scopeRequest: {
	scope: InfisicalLinkScope;
	scopeId: string;
	workspaceId: string;
}) {
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState<InfisicalLinkDraft>(EMPTY_INFISICAL_DRAFT);
	const [failure, setFailure] = useState<InfisicalFailure | null>(null);
	const [syncedKeys, setSyncedKeys] = useState<string[] | null>(null);

	const invalidateLink = () =>
		queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.infisicalLink(
				scopeRequest.scope,
				scopeRequest.scopeId,
			),
		});

	const save = useMutation({
		mutationFn: setInfisicalLink,
		onError: (error) => setFailure(unexpectedFailure(error)),
		onSuccess: async (result) => {
			setFailure(result.failure);

			if (!result.failure) {
				setDraft(EMPTY_INFISICAL_DRAFT);
			}

			await invalidateLink();
		},
	});

	const clear = useMutation({
		mutationFn: () => clearInfisicalLink(scopeRequest),
		onError: (error) => setFailure(unexpectedFailure(error)),
		onSuccess: async (result) => {
			setFailure(result.failure);
			setSyncedKeys(null);
			setDraft(EMPTY_INFISICAL_DRAFT);
			await invalidateLink();
		},
	});

	const sync = useMutation({
		mutationFn: () => syncInfisicalLink(scopeRequest),
		onError: (error) => setFailure(unexpectedFailure(error)),
		onSuccess: async (result) => {
			setFailure(result.failure);
			setSyncedKeys(result.failure ? null : result.keys);
			await invalidateLink();
		},
	});

	return { clear, draft, failure, save, setDraft, sync, syncedKeys };
}
