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
 * The source the viewer shows beside the patch once diff-only mode is off, or
 * null when the read failed or returned something that is not source.
 *
 * Only a utf8 read has source to show: base64 is an image or a PDF and would
 * fill the code surface with megabytes of noise, and binary carries no content
 * at all.
 * @param fileData - The workspace file read, or undefined while it is in flight
 * @returns The file's text, or null when there is none to show
 */
function resolveFullFileText(
	fileData: Awaited<ReturnType<typeof readWorkspaceFile>> | undefined,
): string | null {
	if (!fileData || fileData.error) {
		return null;
	}
	if (fileData.contentEncoding !== 'utf8') {
		return null;
	}
	return fileData.content ?? null;
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
	const diffError = diff.data?.error ?? null;
	const loaded = diffError ? null : (diff.data ?? null);
	const resolvedPath = loaded?.path ?? filePath ?? '';
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
	return {
		fullFileContent: resolveFullFileText(fullFile.data),
		fullFileContentPending: fullFileEnabled && !fullFile.isFetched,
		isTruncated: loaded?.isTruncated ?? false,
		patch,
		placeholder: resolveDiffPlaceholder({
			errorMessage: diffError?.message ?? null,
			hasFilePath: Boolean(filePath),
			hasPatch: Boolean(patch),
			isError: diff.isError,
			isPending: diff.isPending,
			t,
		}),
		resolvedPath,
	};
}
