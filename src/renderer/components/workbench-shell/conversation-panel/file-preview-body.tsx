import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

import { CodeBlockContent } from '@/renderer/components/code-block';
import { MessageResponse } from '@/renderer/components/message';
import { languageForFilePath } from '@/renderer/lib/language-from-path';
import {
	filePreviewMarkdownPreviewAtom,
	filePreviewWordWrapAtom,
} from '@/renderer/state/preferences';
import type { ReadWorkspaceFileResult } from '@/shared/ipc/contracts/workspace-files';

import { resolvePreviewMode } from './file-preview-helpers';

/**
 * Renders the body of a successful file read: an image preview, a formatted
 * markdown preview, or the raw source on the shared code surface.
 */
export function FilePreviewBody({
	filePath,
	result,
}: {
	filePath: string;
	result: ReadWorkspaceFileResult;
}) {
	const { t } = useTranslation();
	const wordWrap = useAtomValue(filePreviewWordWrapAtom);
	const markdownPreview = useAtomValue(filePreviewMarkdownPreviewAtom);
	const { imageSource, showFormattedPreview } = resolvePreviewMode(
		filePath,
		result,
		markdownPreview,
	);
	const content = result.content ?? '';

	if (imageSource) {
		return (
			<div className='sleek-scrollbar flex min-h-0 flex-1 items-center justify-center overflow-auto bg-code p-4'>
				<img
					alt={t(
						'workbench:file-preview.image-alt',
						'Preview of {{filePath}}',
						{
							filePath,
						},
					)}
					className='max-h-full max-w-full rounded-md object-contain shadow-sm'
					src={imageSource}
				/>
			</div>
		);
	}

	if (showFormattedPreview) {
		return (
			<div className='sleek-scrollbar min-h-0 flex-1 overflow-auto p-4'>
				<MessageResponse>{content}</MessageResponse>
			</div>
		);
	}

	return (
		<CodeBlockContent
			className='min-h-0 flex-1'
			code={content}
			language={languageForFilePath(filePath)}
			showLineNumbers
			wrapLines={wordWrap}
		/>
	);
}
