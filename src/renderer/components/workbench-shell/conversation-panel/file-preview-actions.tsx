import { useAtom } from 'jotai';
import { EyeIcon, WrapTextIcon } from 'lucide-react';

import { IconToggle } from '@/renderer/components/icon-toggle';
import { OpenInToolbarMenu } from '@/renderer/components/workbench-shell/open-in-toolbar-menu';
import {
	filePreviewMarkdownPreviewAtom,
	filePreviewWordWrapAtom,
} from '@/renderer/state/preferences';
import type { ReadWorkspaceFileResult } from '@/shared/ipc/contracts/workspace-files';

import { formatSizeBytes, resolvePreviewMode } from './file-preview-helpers';

/**
 * Toolbar actions for the file preview header: size, open-in menu, and the
 * markdown-preview and word-wrap toggles shown only where they apply.
 */
export function FilePreviewActions({
	filePath,
	result,
	workspaceId,
}: {
	filePath: string;
	result: ReadWorkspaceFileResult;
	workspaceId: string;
}) {
	const [wordWrap, setWordWrap] = useAtom(filePreviewWordWrapAtom);
	const [markdownPreview, setMarkdownPreview] = useAtom(
		filePreviewMarkdownPreviewAtom,
	);
	const { imageSource, isMarkdown, showFormattedPreview } = resolvePreviewMode(
		filePath,
		result,
		markdownPreview,
	);

	return (
		<>
			{typeof result.sizeBytes === 'number' ? (
				<span className='text-muted-foreground text-xs tabular-nums'>
					{formatSizeBytes(result.sizeBytes)}
				</span>
			) : null}
			<OpenInToolbarMenu filePath={filePath} workspaceId={workspaceId} />
			{isMarkdown && !imageSource ? (
				<IconToggle
					active={markdownPreview}
					label={markdownPreview ? 'Show raw source' : 'Show formatted preview'}
					onClick={() => setMarkdownPreview(!markdownPreview)}
				>
					<EyeIcon />
				</IconToggle>
			) : null}
			{imageSource || showFormattedPreview ? null : (
				<IconToggle
					active={wordWrap}
					label={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
					onClick={() => setWordWrap(!wordWrap)}
				>
					<WrapTextIcon />
				</IconToggle>
			)}
		</>
	);
}
