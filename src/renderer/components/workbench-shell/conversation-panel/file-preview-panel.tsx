import { Icon } from '@iconify/react';
import { useQuery } from '@tanstack/react-query';
import { TriangleAlertIcon } from 'lucide-react';

import {
	ensemblrQueryKeys,
	readWorkspaceFile,
} from '@/renderer/api/ensemblr-queries';
import { CodeBlockContent } from '@/renderer/components/code-block';
import { languageForFilePath } from '@/renderer/lib/language-from-path';
import { getWorkspaceFileIconNameForPath } from '@/renderer/lib/workbench';
import type {
	ReadWorkspaceFileFailureCode,
	ReadWorkspaceFileResult,
} from '@/shared/ipc/contracts/workspace-files';

/**
 * Read-only file content surface shown when a `kind: 'file'` tab is active.
 * Loads the workspace-relative path through the safe `readWorkspaceFile` IPC,
 * rendering source as code and browser-supported images as image previews.
 */
export function FilePreviewPanel({
	filePath,
	workspaceCwd,
}: {
	filePath: string | null;
	workspaceCwd: string | null;
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
		return (
			<FilePreviewMessage message='This tab has no file associated with it.' />
		);
	}

	if (isPending) {
		return <FilePreviewMessage message={`Loading ${filePath}…`} />;
	}

	if (isError) {
		return (
			<FilePreviewMessage
				message={`Could not read ${filePath}.`}
				tone='error'
			/>
		);
	}

	const result = data;
	if (result.error) {
		return (
			<FilePreviewMessage
				message={describeReadFailure(result.error.code, filePath)}
				tone='error'
			/>
		);
	}

	const imageSource = imageSourceForPreview(result);

	return (
		<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
			<div className='flex h-9 shrink-0 items-center gap-2 border-border border-b bg-muted/30 px-4'>
				<Icon
					aria-hidden='true'
					className='size-3.5 shrink-0 text-muted-foreground'
					icon={getWorkspaceFileIconNameForPath(filePath)}
				/>
				<span className='truncate font-mono text-muted-foreground text-xs'>
					{filePath}
				</span>
				{typeof result.sizeBytes === 'number' ? (
					<span className='ml-auto shrink-0 text-muted-foreground text-xs'>
						{formatSizeBytes(result.sizeBytes)}
					</span>
				) : null}
			</div>
			{imageSource ? (
				<div className='flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/10 p-4'>
					<img
						alt={`Preview of ${filePath}`}
						className='max-h-full max-w-full rounded-md object-contain shadow-sm'
						src={imageSource}
					/>
				</div>
			) : (
				<div className='min-h-0 flex-1 overflow-auto'>
					<CodeBlockContent
						code={result.content ?? ''}
						language={languageForFilePath(filePath)}
						showLineNumbers
					/>
				</div>
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

/** Renders a centered muted or error message inside the file-preview panel. */
function FilePreviewMessage({
	message,
	tone = 'muted',
}: {
	message: string;
	tone?: 'error' | 'muted';
}) {
	return (
		<div className='flex min-h-0 flex-1 items-center justify-center p-6'>
			<div className='flex items-center gap-2 text-sm'>
				{tone === 'error' ? (
					<TriangleAlertIcon
						aria-hidden='true'
						className='size-4 shrink-0 text-destructive'
					/>
				) : null}
				<span
					className={
						tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
					}
				>
					{message}
				</span>
			</div>
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
