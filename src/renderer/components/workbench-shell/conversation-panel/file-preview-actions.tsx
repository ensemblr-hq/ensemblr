import { useAtom } from 'jotai';
import { EyeIcon, WrapTextIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
 *
 * The open-in menu is handed `result.path` rather than the tab's own path: for
 * a file outside the workspace the tab may still carry the `~/…` form the agent
 * wrote, while the result echoes the path main already expanded and resolved.
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
	const { t } = useTranslation();
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
			<OpenInToolbarMenu
				filePath={result.path || filePath}
				workspaceId={workspaceId}
			/>
			{isMarkdown && !imageSource ? (
				<IconToggle
					active={markdownPreview}
					label={
						markdownPreview
							? t(
									'workbench:file-preview.actions.show-source',
									'Show raw source',
								)
							: t(
									'workbench:file-preview.actions.show-preview',
									'Show formatted preview',
								)
					}
					onClick={() => setMarkdownPreview(!markdownPreview)}
				>
					<EyeIcon />
				</IconToggle>
			) : null}
			{imageSource || showFormattedPreview ? null : (
				<IconToggle
					active={wordWrap}
					label={
						wordWrap
							? t(
									'workbench:file-preview.actions.wrap-off',
									'Disable word wrap',
								)
							: t('workbench:file-preview.actions.wrap-on', 'Enable word wrap')
					}
					onClick={() => setWordWrap(!wordWrap)}
				>
					<WrapTextIcon />
				</IconToggle>
			)}
		</>
	);
}
