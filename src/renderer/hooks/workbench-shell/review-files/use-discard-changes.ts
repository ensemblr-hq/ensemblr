import { useCallback, useState } from 'react';

import type {
	DiscardChangesTarget,
	ReviewFileSummary,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

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
 * Discard-confirmation state for the Changes tab. Every discard routes through
 * the confirm dialog rather than reverting inline: the git operation is
 * irreversible, so it stays behind an explicit, cancelable step.
 * @param sourceFiles - The files currently listed, used to resolve a single discard
 * @param workspace - Workspace whose uncommitted files a discard-all targets
 * @returns The pending discard target and the handlers that set and clear it
 */
export function useDiscardChanges({
	sourceFiles,
	workspace,
}: {
	sourceFiles: readonly ReviewFileSummary[];
	workspace: WorkspaceShellModel;
}) {
	const [discardTarget, setDiscardTarget] =
		useState<DiscardChangesTarget | null>(null);

	const handleDiscardFile = useCallback(
		(filePath: string) => {
			const file = sourceFiles.find((entry) => entry.path === filePath);
			const paths = file ? discardPathsOf(file) : [filePath];
			setDiscardTarget({ fileCount: 1, paths, title: filePath });
		},
		[sourceFiles],
	);

	// Discard every uncommitted change at once. Only working-tree files revert,
	// so this always targets the live model's `reviewFiles` regardless of the
	// active source view.
	const handleDiscardAll = useCallback(() => {
		const uncommitted = workspace.reviewFiles;
		if (uncommitted.length === 0) {
			return;
		}
		setDiscardTarget({
			fileCount: uncommitted.length,
			paths: uncommitted.flatMap(discardPathsOf),
			title: `all ${uncommitted.length} uncommitted ${
				uncommitted.length === 1 ? 'change' : 'changes'
			}`,
		});
	}, [workspace.reviewFiles]);

	return {
		discardTarget,
		handleDiscardAll,
		handleDiscardDialogChange: useCallback((open: boolean) => {
			if (!open) {
				setDiscardTarget(null);
			}
		}, []),
		handleDiscardFile,
	};
}
