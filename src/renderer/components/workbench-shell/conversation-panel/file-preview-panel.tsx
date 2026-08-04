import { useQuery } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import { WrapTextIcon } from 'lucide-react';

import {
	ensemblrQueryKeys,
	readWorkspaceFile,
} from '@/renderer/api/ensemblr-queries';
import { CodeBlockContent } from '@/renderer/components/code-block';
import { CodeViewerHeader } from '@/renderer/components/code-surface';
import { IconToggle } from '@/renderer/components/icon-toggle';
import { OpenInToolbarMenu } from '@/renderer/components/workbench-shell/open-in-toolbar-menu';
import { languageForFilePath } from '@/renderer/lib/language-from-path';
import { filePreviewWordWrapAtom } from '@/renderer/state/preferences';
import type {
	ReadWorkspaceFileFailureCode,
	ReadWorkspaceFileResult,
} from '@/shared/ipc/contracts/workspace-files';

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
	const [wordWrap, setWordWrap] = useAtom(filePreviewWordWrapAtom);
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

	const imageSource = imageSourceForPreview(result);

	return (
		<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
			<CodeViewerHeader
				actions={
					<>
						{typeof result.sizeBytes === 'number' ? (
							<span className='text-muted-foreground text-xs tabular-nums'>
								{formatSizeBytes(result.sizeBytes)}
							</span>
						) : null}
						<OpenInToolbarMenu filePath={filePath} workspaceId={workspaceId} />
						{imageSource ? null : (
							<IconToggle
								active={wordWrap}
								label={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
								onClick={() => setWordWrap(!wordWrap)}
							>
								<WrapTextIcon />
							</IconToggle>
						)}
					</>
				}
				title={filePath}
			/>
			{imageSource ? (
				<div className='sleek-scrollbar flex min-h-0 flex-1 items-center justify-center overflow-auto bg-code p-4'>
					<img
						alt={`Preview of ${filePath}`}
						className='max-h-full max-w-full rounded-md object-contain shadow-sm'
						src={imageSource}
					/>
				</div>
			) : (
				<CodeBlockContent
					className='min-h-0 flex-1'
					code={result.content ?? ''}
					language={languageForFilePath(filePath)}
					showLineNumbers
					wrapLines={wordWrap}
				/>
			)}
		</div>
	);
}

/**
 * Builds an embeddable data URL for image payloads returned by file preview.
 * @param result - File-read result from the workspace preview IPC.
 * @returns An image data URL, or null when the result contains text content.
 */
function imageSourceForPreview(result: ReadWorkspaceFileResult): string | null {
	if (
		result.contentEncoding !== 'base64' ||
		!result.mimeType?.startsWith('image/') ||
		!result.content
	) {
		return null;
	}

	return `data:${result.mimeType};base64,${result.content}`;
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

/**
 * Format a byte count as a B/KB/MB string.
 * @param sizeBytes - The size in bytes.
 * @returns The formatted, human-readable size.
 */
function formatSizeBytes(sizeBytes: number): string {
	if (sizeBytes < 1024) {
		return `${sizeBytes} B`;
	}
	if (sizeBytes < 1024 * 1024) {
		return `${(sizeBytes / 1024).toFixed(1)} KB`;
	}
	return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
