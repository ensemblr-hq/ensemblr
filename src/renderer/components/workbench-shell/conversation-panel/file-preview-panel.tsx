import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import {
	ensemblrQueryKeys,
	readWorkspaceFile,
} from '@/renderer/api/ensemblr-queries';
import { CodeViewerHeader } from '@/renderer/components/code-surface';
import { Badge } from '@/renderer/components/ui/badge';

import { FilePreviewActions } from './file-preview-actions';
import { FilePreviewBody } from './file-preview-body';
import { describeReadFailure } from './file-preview-helpers';
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
				badge={
					result.isExternal ? (
						<Badge className='shrink-0' variant='outline'>
							{t(
								'workbench:file-preview.outside-workspace',
								'Outside workspace',
							)}
						</Badge>
					) : null
				}
				title={filePath}
			/>
			<FilePreviewBody filePath={filePath} result={result} />
		</div>
	);
}
