import type { TFunction } from 'i18next';
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
import type {
	ReadWorkspaceFileBinaryReason,
	ReadWorkspaceFileResult,
} from '@/shared/ipc/contracts/workspace-files';
import { PREVIEW_PDF_MIME_TYPE } from '@/shared/preview-media';

import { DOCUMENT_BODY_CLASSES } from './document-column';
import {
	formatSizeBytes,
	previewFormatLabel,
	resolvePreviewMode,
} from './file-preview-helpers';
import { PanelMessage } from './panel-message';

/**
 * Renders the body of a successful file read: an image preview, an embedded PDF,
 * a formatted markdown preview, a notice for bytes nothing here can render, or
 * the raw source on the shared code surface.
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

	if (result.contentEncoding === 'binary') {
		return (
			<PanelMessage
				message={describeBinaryPreview({
					filePath,
					format: result.mimeType ? previewFormatLabel(result.mimeType) : '',
					reason: result.binaryReason ?? 'not-text',
					size: formatSizeBytes(result.sizeBytes ?? 0),
					t,
				})}
			/>
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

/**
 * Explains a preview that has bytes but nothing to draw them with, in the terms
 * the reason distinguishes: a file whose extension lies about being an image or
 * a PDF, a real image format no engine decodes, or anything else that is simply
 * not text. Every reason is spelled out rather than defaulted, so a new one
 * added to the contract fails the build instead of quietly reading as "not text".
 * @param params - The path, its format name (empty when it names no image), the
 *   reason from the read, the formatted size, and the translator.
 * @returns The message the panel renders in place of a preview.
 */
function describeBinaryPreview({
	filePath,
	format,
	reason,
	size,
	t,
}: {
	filePath: string;
	format: string;
	reason: ReadWorkspaceFileBinaryReason;
	size: string;
	t: TFunction;
}): string {
	switch (reason) {
		case 'invalid-document':
			return t(
				'workbench:file-preview.binary.invalid-document',
				'{{filePath}} is not a valid PDF ({{size}}).',
				{ filePath, size },
			);
		case 'invalid-image':
			return t(
				'workbench:file-preview.binary.invalid-image',
				'{{filePath}} is not a valid {{format}} image ({{size}}).',
				{ filePath, format, size },
			);
		case 'unsupported-image':
			return t(
				'workbench:file-preview.binary.unsupported-image',
				'{{format}} images cannot be displayed here ({{size}}).',
				{ format, size },
			);
		case 'not-text':
			return t(
				'workbench:file-preview.binary.not-text',
				'{{filePath}} is not text and cannot be previewed ({{size}}).',
				{ filePath, size },
			);
		default:
			return reason satisfies never;
	}
}
