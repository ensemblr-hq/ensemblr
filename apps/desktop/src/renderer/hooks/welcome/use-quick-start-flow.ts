import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useAtom, useSetAtom } from 'jotai';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
	githubOwnerListQuery,
	isEnsemblrApiAvailable,
	quickStartProject,
	rootDirectoryQuery,
	selectCloneDestination,
} from '@/renderer/api/ensemblr-queries';
import { failureText } from '@/renderer/lib/failure-text';
import { seedFirstWorkspace } from '@/renderer/lib/workbench/seed-first-workspace';
import { lastQuickStartOwnerAtom } from '@/renderer/state/preferences';
import { lastWorkspaceSelectionAtom } from '@/renderer/state/workspace';
import type {
	GithubOwnerEntry,
	QuickStartProjectDiagnostic,
	QuickStartProjectResult,
} from '@/shared/ipc/contracts/quick-start';

/** Top-level UI states the quick-start flow moves through. */
type QuickStartStage = 'creating' | 'failure' | 'idle';

/** State and handlers exposed by {@link useQuickStartFlow}. */
interface UseQuickStartFlowResult {
	defaultParentPath: string;
	diagnostics: QuickStartProjectDiagnostic[];
	isBusy: boolean;
	owner: string;
	owners: readonly GithubOwnerEntry[];
	ownersLoading: boolean;
	parentPath: string;
	parentPathOverride: string | null;
	pickParentPath: () => Promise<void>;
	resetParentPath: () => void;
	retry: () => void;
	setOwner: (login: string) => void;
	setParentPathOverride: (value: string | null) => void;
	stage: QuickStartStage;
	startQuickStart: (input: {
		name: string;
	}) => Promise<QuickStartProjectResult | null>;
	successResult: QuickStartProjectResult | null;
}

/**
 * Owns the quick-start flow state machine: stages, diagnostics, parent-path and
 * GitHub-owner selection, IPC orchestration, and the post-success seed +
 * navigation.
 * @returns Flow state plus `startQuickStart` / `retry` handlers.
 */
export function useQuickStartFlow({
	onSuccess,
}: {
	onSuccess?: () => void;
} = {}): UseQuickStartFlowResult {
	const navigate = useNavigate();
	const router = useRouter();
	const { t } = useTranslation();
	const setLastWorkspaceSelection = useSetAtom(lastWorkspaceSelectionAtom);
	const [lastOwner, setLastOwner] = useAtom(lastQuickStartOwnerAtom);
	const { data: rootDirectoryData } = useQuery({
		...rootDirectoryQuery,
		enabled: isEnsemblrApiAvailable(),
	});
	const defaultParentPath = rootDirectoryData?.repositoriesPath ?? '';
	const apiAvailable = isEnsemblrApiAvailable();
	const { data: ownerData, isPending: ownersPending } = useQuery({
		...githubOwnerListQuery,
		enabled: apiAvailable,
	});
	// Only a user who last published into an organization has anything to lose
	// by acting before `gh` answers, so only they are held. With no remembered
	// owner the picker resolves to the signed-in user, which is already what an
	// unblocked Create publishes under — so everyone else gets the dialog
	// exactly as it was before the picker existed: no placeholder row, no wait.
	const ownersLoading = apiAvailable && ownersPending && lastOwner !== null;

	const [stage, setStage] = useState<QuickStartStage>('idle');
	const [diagnostics, setDiagnostics] = useState<QuickStartProjectDiagnostic[]>(
		[],
	);
	const [parentPathOverride, setParentPathOverride] = useState<string | null>(
		null,
	);
	const [ownerOverride, setOwnerOverride] = useState<string | null>(null);
	const [successResult, setSuccessResult] =
		useState<QuickStartProjectResult | null>(null);

	// Empty whenever there is no real choice to make — gh could not answer, or
	// the only publishable account is the signed-in user. The picker hides
	// itself on an empty list and no owner is sent, so quick-start behaves
	// exactly as it did before the picker existed.
	const owners = useMemo<readonly GithubOwnerEntry[]>(() => {
		const entries = ownerData?.status === 'success' ? ownerData.owners : [];
		return entries.length > 1 ? entries : [];
	}, [ownerData]);

	const viewerLogin =
		owners.find((entry) => entry.kind === 'user')?.login ?? '';
	const rememberedOwner = owners.some(
		(entry) => entry.login === lastOwner && entry.canCreate,
	)
		? lastOwner
		: null;
	const owner = ownerOverride ?? rememberedOwner ?? viewerLogin;

	// Derive the shown path: user override if they touched it, else the
	// managed default once the query resolves. Avoids a sync effect.
	const parentPath = parentPathOverride ?? defaultParentPath;

	const pickParentPath = useCallback(async () => {
		if (!isEnsemblrApiAvailable()) {
			return;
		}
		const selection = await selectCloneDestination();
		if (selection.canceled || !selection.path) {
			return;
		}
		setParentPathOverride(selection.path);
	}, []);

	const resetParentPath = useCallback(() => {
		setParentPathOverride(null);
	}, []);

	const setOwner = useCallback((login: string) => {
		setOwnerOverride(login);
	}, []);

	const startQuickStart = useCallback(
		async ({ name }: { name: string }) => {
			setStage('creating');
			setDiagnostics([]);
			setSuccessResult(null);

			const parentOverride = parentPath.trim();
			const ownerOverrideForRequest =
				owner && owner !== viewerLogin ? owner : '';
			const result = await quickStartProject({
				name,
				...(ownerOverrideForRequest ? { owner: ownerOverrideForRequest } : {}),
				...(parentOverride ? { parentPath: parentOverride } : {}),
			});

			if (result.status === 'success' && result.repository) {
				const repository = result.repository;
				setSuccessResult(result);
				if (owner) {
					setLastOwner(owner === viewerLogin ? null : owner);
				}
				const seed = await seedFirstWorkspace({
					navigate,
					persistSelection: setLastWorkspaceSelection,
					repositoryId: repository.id,
					router,
				});
				const warnings = result.diagnostics.filter(
					(diagnostic) => diagnostic.severity === 'warning',
				);
				if (seed.status === 'success') {
					toast.success(
						t('errors:quick-start.created.title', 'Created project {{name}}.', {
							name: repository.name,
						}),
					);
				} else {
					toast.error(
						seed.error ??
							t(
								'errors:quick-start.open-failed.title',
								'Created {{name}}, opening failed.',
								{ name: repository.name },
							),
					);
				}
				// Surface publish (and any future) warnings regardless of whether
				// opening the first workspace succeeded — the project may have no
				// GitHub remote either way.
				for (const warning of warnings) {
					toast.warning(failureText(t, warning) ?? warning.message);
				}
				onSuccess?.();
				return result;
			}

			setStage('failure');
			setDiagnostics(result.diagnostics);
			return result;
		},
		[
			navigate,
			onSuccess,
			owner,
			parentPath,
			router,
			setLastOwner,
			setLastWorkspaceSelection,
			t,
			viewerLogin,
		],
	);

	const retry = useCallback(() => {
		setStage('idle');
		setDiagnostics([]);
	}, []);

	return {
		defaultParentPath,
		diagnostics,
		isBusy: stage === 'creating',
		owner,
		owners,
		ownersLoading,
		parentPath,
		parentPathOverride,
		pickParentPath,
		resetParentPath,
		retry,
		setOwner,
		setParentPathOverride,
		stage,
		startQuickStart,
		successResult,
	};
}
