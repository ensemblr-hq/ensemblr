import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	discardWorkspaceChanges,
	ensemblrQueryKeys,
	invalidateWorkspaceGitStatus,
	removeDiscardedPathsFromGitStatus,
} from '@/renderer/api/ensemblr';
import { failureText } from '@/renderer/lib/failure-text';
import type {
	DiscardChangesTarget,
	ReviewFileSummary,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

/** Shared empty set, so a settled discard hands back a stable reference. */
const NO_PENDING_PATHS: ReadonlySet<string> = new Set();

/**
 * Expands a review file to every path a discard has to revert: a rename carries
 * both its new path and the original it came from.
 * @param file - The file being discarded
 * @returns The path or pair of paths git must restore
 */
function discardPathsOf(file: ReviewFileSummary): string[] {
	return file.renamedFrom ? [file.path, file.renamedFrom] : [file.path];
}

/**
 * Owns the Changes tab's discard: the confirmation target, the git call, and how
 * the change set settles afterwards. Every discard routes through the confirm
 * dialog rather than reverting inline, since the git operation is irreversible.
 *
 * While the call is in flight the targeted paths are reported as pending so their
 * rows mute; on success they leave the cached working-tree change set at once,
 * and every scope the workspace is cached under is refreshed from git.
 * @param sourceFiles - The files currently listed, used to resolve a single discard
 * @param workspace - Workspace whose uncommitted files a discard targets
 * @returns The pending discard target and paths, the confirm handler, and the failure text
 */
export function useDiscardChanges({
	sourceFiles,
	workspace,
}: {
	sourceFiles: readonly ReviewFileSummary[];
	workspace: WorkspaceShellModel;
}) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const workspaceCwd = workspace.pathLabel;
	const [discardTarget, setDiscardTarget] =
		useState<DiscardChangesTarget | null>(null);
	const [discardErrorMessage, setDiscardErrorMessage] = useState<string | null>(
		null,
	);
	const [pendingDiscardPaths, setPendingDiscardPaths] =
		useState<ReadonlySet<string>>(NO_PENDING_PATHS);

	const openDiscardTarget = useCallback((target: DiscardChangesTarget) => {
		setDiscardErrorMessage(null);
		setDiscardTarget(target);
	}, []);

	const mutation = useMutation({
		mutationFn: () =>
			discardWorkspaceChanges({
				paths: discardTarget?.paths ?? [],
				workspaceCwd,
			}),
		onError: (error) =>
			setDiscardErrorMessage(
				error instanceof Error
					? error.message
					: t('errors:discard-changes.failed', 'Could not discard changes.'),
			),
		onMutate: () => {
			setPendingDiscardPaths(new Set(discardTarget?.paths ?? []));
		},
		onSettled: () => {
			setPendingDiscardPaths(NO_PENDING_PATHS);
			// Some files may have been discarded even on partial failure, so refresh
			// both the change set and the lazy file tree regardless of outcome.
			void invalidateWorkspaceGitStatus(queryClient, workspaceCwd);
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.workspaceFiles(workspaceCwd),
			});
		},
		onSuccess: (result) => {
			removeDiscardedPathsFromGitStatus(queryClient, {
				discarded: result.discarded,
				workspaceCwd,
			});
			if (result.error) {
				setDiscardErrorMessage(failureText(t, result.error));
				return;
			}
			setDiscardTarget(null);
		},
	});

	const handleDiscardFile = useCallback(
		(filePath: string) => {
			const file = sourceFiles.find((entry) => entry.path === filePath);
			const paths = file ? discardPathsOf(file) : [filePath];
			openDiscardTarget({ fileCount: 1, paths, title: filePath });
		},
		[openDiscardTarget, sourceFiles],
	);

	// Discard every uncommitted change at once. Only working-tree files revert,
	// so this always targets the live model's `reviewFiles` regardless of the
	// active source view.
	const handleDiscardAll = useCallback(() => {
		const uncommitted = workspace.reviewFiles;
		if (uncommitted.length === 0) {
			return;
		}
		openDiscardTarget({
			fileCount: uncommitted.length,
			paths: uncommitted.flatMap(discardPathsOf),
			title: t('review:discard-changes.all-uncommitted-target', {
				count: uncommitted.length,
				defaultValue_one: 'all {{count}} uncommitted change',
				defaultValue_other: 'all {{count}} uncommitted changes',
			}),
		});
	}, [openDiscardTarget, t, workspace.reviewFiles]);

	const { mutate } = mutation;

	return {
		discardErrorMessage,
		discardTarget,
		handleDiscardAll,
		handleDiscardConfirm: useCallback(() => {
			mutate();
		}, [mutate]),
		handleDiscardDialogChange: useCallback((open: boolean) => {
			if (!open) {
				setDiscardTarget(null);
			}
		}, []),
		handleDiscardFile,
		isDiscarding: mutation.isPending,
		pendingDiscardPaths,
	};
}
