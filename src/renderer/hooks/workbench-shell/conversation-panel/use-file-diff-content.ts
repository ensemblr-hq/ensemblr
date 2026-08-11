import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import {
	ensemblrQueryKeys,
	readWorkspaceFile,
	workspaceFileDiffQuery,
} from '@/renderer/api/ensemblr-queries';
import { diffNewSideIsWorkingTree } from '@/renderer/lib/diff/scope';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

/** Message shown in place of the diff viewer while no patch is renderable. */
interface DiffPlaceholder {
	message: string;
	tone?: 'error';
}

/**
 * Picks the placeholder a diff panel shows instead of the viewer, in the order
 * the states become knowable: no file, still loading, transport failure, a
 * git-reported error, then an empty patch.
 * @param options - Query state plus whether the tab carries a file and a patch
 * @returns The placeholder to render, or null once the patch is renderable
 */
function resolveDiffPlaceholder({
	errorMessage,
	hasFilePath,
	hasPatch,
	isError,
	isPending,
	t,
}: {
	errorMessage: string | null;
	hasFilePath: boolean;
	hasPatch: boolean;
	isError: boolean;
	isPending: boolean;
	t: TFunction;
}): DiffPlaceholder | null {
	if (!hasFilePath) {
		return {
			message: t(
				'workbench:file-diff.no-file',
				'This tab has no file associated.',
			),
		};
	}
	if (isPending) {
		return { message: t('workbench:file-diff.loading', 'Loading diff…') };
	}
	if (isError) {
		return {
			message: t('workbench:file-diff.load-failed', 'Could not load diff.'),
			tone: 'error',
		};
	}
	if (errorMessage) {
		return { message: errorMessage, tone: 'error' };
	}
	if (!hasPatch) {
		return {
			message: t('workbench:file-diff.no-changes', 'No changes in this file.'),
		};
	}
	return null;
}

/**
 * Loads one file's unified patch alongside the full working-tree file the
 * viewer reveals when the user turns off diff-only mode, and resolves the
 * placeholder to show while no patch is renderable.
 * @param filePath - Workspace-relative path the tab points at, or null when it carries none
 * @param scope - Which diff to load; the working tree by default
 * @param workspaceCwd - Absolute workspace path the git commands run in
 * @returns The patch, the full-file content, and the placeholder to render instead when set
 */
export function useFileDiffContent({
	filePath,
	scope,
	workspaceCwd,
}: {
	filePath: string | null;
	scope?: WorkspaceGitDiffScope;
	workspaceCwd: string | null;
}) {
	const { t } = useTranslation();
	const diff = useQuery(
		workspaceFileDiffQuery({ filePath, scope, workspaceCwd }),
	);
	const loaded = diff.data && !diff.data.error ? diff.data : null;
	const resolvedPath = loaded ? loaded.path : (filePath ?? '');
	const patch = loaded?.patch ?? '';

	const fullFileEnabled =
		diffNewSideIsWorkingTree(scope) && Boolean(resolvedPath && workspaceCwd);
	const fullFile = useQuery({
		enabled: fullFileEnabled,
		queryFn: () =>
			readWorkspaceFile({
				path: resolvedPath,
				workspaceCwd: workspaceCwd ?? '',
			}),
		queryKey: ensemblrQueryKeys.filePreview(workspaceCwd ?? '', resolvedPath),
		staleTime: 10_000,
	});
	const fileData = fullFile.data;

	// A read that came back base64 is an image or a PDF; there is no source to
	// show beside the patch, and handing the code surface base64 would fill it
	// with megabytes of noise.
	const fullFileIsText = fileData?.contentEncoding !== 'base64';

	return {
		fullFileContent:
			fileData && !fileData.error && fullFileIsText
				? (fileData.content ?? null)
				: null,
		fullFileContentPending: fullFileEnabled && !fullFile.isFetched,
		isTruncated: loaded?.isTruncated ?? false,
		patch,
		placeholder: resolveDiffPlaceholder({
			errorMessage: diff.data?.error?.message ?? null,
			hasFilePath: Boolean(filePath),
			hasPatch: Boolean(patch),
			isError: diff.isError,
			isPending: diff.isPending,
			t,
		}),
		resolvedPath,
	};
}
