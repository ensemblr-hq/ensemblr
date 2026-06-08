/** Returns the first non-blank line of `text`; empty string otherwise. */
export function firstLine(text: string): string {
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed) {
			return trimmed;
		}
	}
	return '';
}
