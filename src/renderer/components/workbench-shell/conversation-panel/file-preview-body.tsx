import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

import { CodeBlockContent } from '@/renderer/components/code-block';
import { MessageResponse } from '@/renderer/components/message';
import { usePdfObjectUrl } from '@/renderer/hooks/workbench-shell/conversation-panel/use-pdf-object-url';
import { languageForFilePath } from '@/renderer/lib/language-from-path';
import {
	filePreviewMarkdownPreviewAtom,
	filePreviewWordWrapAtom,
} from '@/renderer/state/preferences';
import type { ReadWorkspaceFileResult } from '@/shared/ipc/contracts/workspace-files';
import { PREVIEW_PDF_MIME_TYPE } from '@/shared/preview-media';

import { DOCUMENT_BODY_CLASSES } from './document-column';
import { resolvePreviewMode } from './file-preview-helpers';

/**
 * Renders the body of a successful file read: an image preview, an embedded PDF,
 * a formatted markdown preview, or the raw source on the shared code surface.
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
	const { imageSource, pdfContent, showFormattedPreview } = resolvePreviewMode(
		filePath,
		result,
		markdownPreview,
	);
	const pdfObjectUrl = usePdfObjectUrl(pdfContent);
	const content = result.content ?? '';

	if (pdfContent) {
		return (
			<div className='min-h-0 flex-1 bg-code'>
				{pdfObjectUrl ? (
					<embed
						aria-label={t(
							'workbench:file-preview.pdf-title',
							'Preview of {{filePath}}',
							{ filePath },
						)}
						className='size-full'
						src={pdfObjectUrl}
						type={PREVIEW_PDF_MIME_TYPE}
					/>
				) : null}
			</div>
		);
	}

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
			<div className='sleek-scrollbar min-h-0 flex-1 overflow-auto'>
				<div className={DOCUMENT_BODY_CLASSES}>
					<MessageResponse>{content}</MessageResponse>
				</div>
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
