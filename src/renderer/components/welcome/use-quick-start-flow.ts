import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import {
	isEnsembleApiAvailable,
	quickStartProject,
	rootDirectoryQuery,
	selectCloneDestination,
} from '@/renderer/api/ensemble-queries';
import { seedFirstWorkspace } from '@/renderer/lib/workbench/seed-first-workspace';
import type {
	QuickStartProjectDiagnostic,
	QuickStartProjectResult,
} from '@/shared/ipc';

/** Top-level UI states the quick-start flow moves through. */
export type QuickStartStage = 'creating' | 'failure' | 'idle';

export interface UseQuickStartFlowResult {
	defaultParentPath: string;
	diagnostics: QuickStartProjectDiagnostic[];
	isBusy: boolean;
	parentPath: string;
	parentPathOverride: string | null;
	pickParentPath: () => Promise<void>;
	resetParentPath: () => void;
	retry: () => void;
	setParentPathOverride: (value: string | null) => void;
	stage: QuickStartStage;
	startQuickStart: (input: {
		name: string;
	}) => Promise<QuickStartProjectResult | null>;
	successResult: QuickStartProjectResult | null;
}

/**
 * Owns the quick-start flow state machine: stages, diagnostics, parent-path
 * override, IPC orchestration, and the post-success seed + navigation.
 * @returns Flow state plus `startQuickStart` / `retry` handlers.
 */
export function useQuickStartFlow({
	onSuccess,
}: {
	onSuccess?: () => void;
} = {}): UseQuickStartFlowResult {
	const navigate = useNavigate();
	const router = useRouter();
	const { data: rootDirectoryData } = useQuery({
		...rootDirectoryQuery,
		enabled: isEnsembleApiAvailable(),
	});
	const defaultParentPath = rootDirectoryData?.repositoriesPath ?? '';

	const [stage, setStage] = useState<QuickStartStage>('idle');
	const [diagnostics, setDiagnostics] = useState<QuickStartProjectDiagnostic[]>(
		[],
	);
	const [parentPathOverride, setParentPathOverride] = useState<string | null>(
		null,
	);
	const [successResult, setSuccessResult] =
		useState<QuickStartProjectResult | null>(null);

	// Derive the shown path: user override if they touched it, else the
	// managed default once the query resolves. Avoids a sync effect.
	const parentPath = parentPathOverride ?? defaultParentPath;

	const pickParentPath = useCallback(async () => {
		if (!isEnsembleApiAvailable()) {
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

	const startQuickStart = useCallback(
		async ({ name }: { name: string }) => {
			setStage('creating');
			setDiagnostics([]);
			setSuccessResult(null);

			const parentOverride = parentPath.trim();
			const result = await quickStartProject({
				name,
				...(parentOverride ? { parentPath: parentOverride } : {}),
			});

			if (result.status === 'success' && result.repository) {
				const repository = result.repository;
				setSuccessResult(result);
				const seed = await seedFirstWorkspace({
					navigate,
					repositoryId: repository.id,
					router,
				});
				if (seed.status === 'success') {
					toast.success(`Created project ${repository.name}.`);
					onSuccess?.();
					return result;
				}
				toast.error(
					seed.error ?? `Created ${repository.name}, opening failed.`,
				);
				onSuccess?.();
				return result;
			}

			setStage('failure');
			setDiagnostics(result.diagnostics);
			return result;
		},
		[navigate, onSuccess, parentPath, router],
	);

	const retry = useCallback(() => {
		setStage('idle');
		setDiagnostics([]);
	}, []);

	return {
		defaultParentPath,
		diagnostics,
		isBusy: stage === 'creating',
		parentPath,
		parentPathOverride,
		pickParentPath,
		resetParentPath,
		retry,
		setParentPathOverride,
		stage,
		startQuickStart,
		successResult,
	};
}
