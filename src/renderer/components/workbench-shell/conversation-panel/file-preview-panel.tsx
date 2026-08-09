import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

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
	const { t } = useTranslation();
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
		return (
			<PanelMessage
				message={t(
					'workbench:file-preview.empty.no-file',
					'This tab has no file associated with it.',
				)}
			/>
		);
	}

	if (isPending) {
		return (
			<PanelMessage
				message={t(
					'workbench:file-preview.empty.loading',
					'Loading {{filePath}}…',
					{
						filePath,
					},
				)}
			/>
		);
	}

	if (isError) {
		return (
			<PanelMessage
				message={t(
					'workbench:file-preview.failure.unreadable',
					'Could not read {{filePath}}.',
					{ filePath },
				)}
				tone='error'
			/>
		);
	}

	const result = data;
	if (result.error) {
		return (
			<PanelMessage
				message={describeReadFailure(result.error.code, filePath, t)}
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
 * @param t - Translator from the calling component, so the message follows the UI language.
 * @returns A user-facing explanation of the failure.
 */
function describeReadFailure(
	code: ReadWorkspaceFileFailureCode,
	filePath: string,
	t: TFunction,
): string {
	switch (code) {
		case 'not-found':
			return t(
				'workbench:file-preview.failure.not-found',
				'{{filePath}} does not exist in this workspace.',
				{ filePath },
			);
		case 'not-file':
			return t(
				'workbench:file-preview.failure.not-file',
				'{{filePath}} is a directory and cannot be previewed.',
				{ filePath },
			);
		case 'too-large':
			return t(
				'workbench:file-preview.failure.too-large',
				'{{filePath}} is too large to preview.',
				{ filePath },
			);
		case 'invalid-path':
			return t(
				'workbench:file-preview.failure.invalid-path',
				'{{filePath}} is outside this workspace.',
				{ filePath },
			);
		case 'invalid-cwd':
			return t(
				'workbench:file-preview.failure.invalid-cwd',
				'The workspace directory is unavailable.',
			);
		default:
			return t(
				'workbench:file-preview.failure.unreadable',
				'Could not read {{filePath}}.',
				{ filePath },
			);
	}
}
