import { useNavigate, useRouter } from '@tanstack/react-router';
import { useSetAtom } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
	prepareCloneGithubRepository,
	startCloneGithubRepository,
	subscribeCloneGithubRepositoryProgress,
} from '@/renderer/api/ensemblr-queries';
import { seedFirstWorkspace } from '@/renderer/lib/workbench/seed-first-workspace';
import { lastWorkspaceSelectionAtom } from '@/renderer/state/workspace';
import type { CloneStage } from '@/renderer/types/welcome';
import type {
	CloneGithubRepositoryDiagnostic,
	CloneGithubRepositoryProgressEvent,
	CloneGithubRepositoryStartResult,
} from '@/shared/ipc/contracts/clone';

/** State and handlers exposed by {@link useCloneFlow}. */
interface UseCloneFlowResult {
	diagnostics: CloneGithubRepositoryDiagnostic[];
	isBusy: boolean;
	logs: CloneGithubRepositoryProgressEvent[];
	retry: () => void;
	stage: CloneStage;
	startClone: (input: {
		destinationPath?: string;
		url: string;
	}) => Promise<void>;
	successResult: CloneGithubRepositoryStartResult | null;
}

/**
 * Owns the clone-flow state machine: stages, diagnostics, progress events,
 * IPC prepare/start, and the post-success cache invalidation.
 * @returns Flow state plus `startClone` / `retry` handlers.
 */
export function useCloneFlow(): UseCloneFlowResult {
	const navigate = useNavigate();
	const router = useRouter();
	const setLastWorkspaceSelection = useSetAtom(lastWorkspaceSelectionAtom);
	const [stage, setStage] = useState<CloneStage>('idle');
	const [diagnostics, setDiagnostics] = useState<
		CloneGithubRepositoryDiagnostic[]
	>([]);
	const [logs, setLogs] = useState<CloneGithubRepositoryProgressEvent[]>([]);
	const [activeJobId, setActiveJobId] = useState<string | null>(null);
	const [successResult, setSuccessResult] =
		useState<CloneGithubRepositoryStartResult | null>(null);

	useEffect(() => {
		if (!activeJobId) {
			return;
		}
		const unsubscribe = subscribeCloneGithubRepositoryProgress((event) => {
			if (event.jobId !== activeJobId) {
				return;
			}
			setLogs((current) => [...current, event]);
		});
		return () => {
			unsubscribe();
		};
	}, [activeJobId]);

	const startClone = useCallback(
		async ({
			destinationPath,
			url,
		}: {
			destinationPath?: string;
			url: string;
		}) => {
			setStage('preparing');
			setDiagnostics([]);
			setLogs([]);
			setSuccessResult(null);
			setActiveJobId(null);

			const preparation = await prepareCloneGithubRepository(
				destinationPath !== undefined ? { destinationPath, url } : { url },
			);

			if (!preparation.ok) {
				setStage('failure');
				setDiagnostics(preparation.diagnostics);
				return;
			}

			setActiveJobId(preparation.preparation.jobId);
			setStage('cloning');

			const result = await startCloneGithubRepository({
				jobId: preparation.preparation.jobId,
			});

			setLogs(result.logs);
			setActiveJobId(null);

			if (result.status === 'success' && result.repository) {
				const repository = result.repository;
				setSuccessResult(result);
				setStage('opening');
				const seed = await seedFirstWorkspace({
					navigate,
					persistSelection: setLastWorkspaceSelection,
					repositoryId: repository.id,
					router,
				});
				if (seed.status === 'success') {
					setStage('success');
					toast.success(`Cloned ${repository.name}.`);
				} else {
					setStage('failure');
					toast.error(
						seed.error ?? `Cloned ${repository.name}, opening failed.`,
					);
				}
				return;
			}

			setStage('failure');
			setDiagnostics(result.diagnostics);
		},
		[navigate, router, setLastWorkspaceSelection],
	);

	const retry = useCallback(() => {
		setStage('idle');
		setDiagnostics([]);
	}, []);

	return {
		diagnostics,
		isBusy: stage === 'preparing' || stage === 'cloning' || stage === 'opening',
		logs,
		retry,
		stage,
		startClone,
		successResult,
	};
}
