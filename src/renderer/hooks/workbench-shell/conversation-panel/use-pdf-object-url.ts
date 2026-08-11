import { useEffect, useState } from 'react';

import { PREVIEW_PDF_MIME_TYPE } from '@/shared/preview-media';

/**
 * Decodes a base64 PDF body into the bytes a Blob is built from.
 * @param base64 - The base64 body returned by the file-preview read.
 * @returns The decoded bytes.
 */
function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
	const binary = atob(base64);
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

/**
 * Turns a base64 PDF body into a blob URL the embedded viewer can load, and
 * revokes it when the preview moves on. A blob rather than a `data:` URL because
 * Chromium refuses to navigate a frame to `data:`.
 * @param base64 - The base64 PDF body, or null when the file is not a PDF.
 * @returns The object URL, or null while there is nothing to show.
 */
export function usePdfObjectUrl(base64: string | null): string | null {
	const [objectUrl, setObjectUrl] = useState<string | null>(null);

	useEffect(() => {
		if (!base64) {
			setObjectUrl(null);
			return;
		}
		const url = URL.createObjectURL(
			new Blob([decodeBase64(base64)], { type: PREVIEW_PDF_MIME_TYPE }),
		);
		setObjectUrl(url);
		return () => {
			URL.revokeObjectURL(url);
		};
	}, [base64]);

	return objectUrl;
}
