import { useQuery } from '@tanstack/react-query';

import {
	ensemblrQueryKeys,
	readWorkspaceFile,
} from '@/renderer/api/ensemblr-queries';
import { CodeViewerHeader } from '@/renderer/components/code-surface';
import type { ReadWorkspaceFileFailureCode } from '@/shared/ipc/contracts/workspace-files';

import { FilePreviewActions } from './file-preview-actions';
import { FilePreviewBody } from './file-preview-body';
import { PanelMessage } from './panel-message';

/**
 * Read-only file content surface shown when a `kind: 'file'` tab is active.
 * Loads the workspace-relative path through the safe `readWorkspaceFile` IPC,
 * rendering source as code and browser-supported images as image previews.
 */
export function FilePreviewPanel({
	filePath,
	workspaceCwd,
	workspaceId,
}: {
	filePath: string | null;
	workspaceCwd: string | null;
	workspaceId: string;
}) {
	const { data, isError, isPending } = useQuery({
		enabled: Boolean(filePath && workspaceCwd),
		queryFn: () =>
			readWorkspaceFile({
				path: filePath ?? '',
				workspaceCwd: workspaceCwd ?? '',
			}),
		queryKey: ensemblrQueryKeys.filePreview(workspaceCwd ?? '', filePath ?? ''),
		staleTime: 10_000,
	});

	if (!filePath || !workspaceCwd) {
		return <PanelMessage message='This tab has no file associated with it.' />;
	}

	if (isPending) {
		return <PanelMessage message={`Loading ${filePath}…`} />;
	}

	if (isError) {
		return (
			<PanelMessage message={`Could not read ${filePath}.`} tone='error' />
		);
	}

	const result = data;
	if (result.error) {
		return (
			<PanelMessage
				message={describeReadFailure(result.error.code, filePath)}
				tone='error'
			/>
		);
	}

	return (
		<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
			<CodeViewerHeader
				actions={
					<FilePreviewActions
						filePath={filePath}
						result={result}
						workspaceId={workspaceId}
					/>
				}
				title={filePath}
			/>
			<FilePreviewBody filePath={filePath} result={result} />
		</div>
	);
}

/**
 * Build a human-readable message for a workspace file read failure.
 * @param code - The read-failure code.
 * @param filePath - The path that failed to read.
 * @returns A user-facing explanation of the failure.
 */
function describeReadFailure(
	code: ReadWorkspaceFileFailureCode,
	filePath: string,
): string {
	switch (code) {
		case 'not-found':
			return `${filePath} does not exist in this workspace.`;
		case 'not-file':
			return `${filePath} is a directory and cannot be previewed.`;
		case 'too-large':
			return `${filePath} is too large to preview.`;
		case 'invalid-path':
			return `${filePath} is outside this workspace.`;
		case 'invalid-cwd':
			return 'The workspace directory is unavailable.';
		default:
			return `Could not read ${filePath}.`;
	}
}
