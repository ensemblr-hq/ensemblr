import { i18n } from '@/renderer/lib/i18n';

/** Bytes in a kibibyte, the unit the notice rounds to below a mebibyte. */
const BYTES_PER_KIB = 1024;

/** Bytes in a mebibyte, the unit the notice switches to once it is reached. */
const BYTES_PER_MIB = BYTES_PER_KIB * BYTES_PER_KIB;

/**
 * Renders a dropped-byte count at a size a reader can weigh, rounded to whole
 * units because the exact figure is noise next to "there is more than this".
 * @param bytes - How many bytes the writer dropped
 * @returns The size as a short label, e.g. `240 KB` or `3 MB`
 */
function formatDroppedBytes(bytes: number): string {
	if (bytes >= BYTES_PER_MIB) {
		return `${Math.round(bytes / BYTES_PER_MIB)} MB`;
	}
	return `${Math.max(1, Math.round(bytes / BYTES_PER_KIB))} KB`;
}

/**
 * The line a surface appends to a payload the event log had to cut short.
 *
 * A persisted event payload is capped, and the writer keeps the head of the
 * bulk-carrying field — so without this a truncated tool result reads as a
 * complete one that simply ended where it ended, which is the one reading that
 * is always wrong.
 * @param truncatedBytes - Bytes dropped, as the wire payload reported them
 * @returns The notice, or null when nothing was dropped
 */
function truncationNotice(truncatedBytes: number | undefined): string | null {
	if (typeof truncatedBytes !== 'number' || truncatedBytes <= 0) {
		return null;
	}
	return i18n.t(
		'workbench:timeline.payload-truncated',
		'[output truncated — {{size}} not shown]',
		{ size: formatDroppedBytes(truncatedBytes) },
	);
}

/**
 * Appends the truncation notice to a payload's text when the event log cut it
 * short, leaving an untruncated payload's text untouched by identity.
 * @param text - The text as the wire carried it
 * @param truncatedBytes - Bytes dropped, as the wire payload reported them
 * @returns The text, with the notice appended when one applies
 */
export function withTruncationNotice(
	text: string,
	truncatedBytes: number | undefined,
): string {
	const notice = truncationNotice(truncatedBytes);
	if (!notice) {
		return text;
	}
	return text.length > 0 ? `${text}\n\n${notice}` : notice;
}
