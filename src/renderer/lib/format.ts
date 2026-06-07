/** Pluralizes a count with a fallback singular noun (`1 file` vs `2 files`). */
export function formatCount(count: number, singular: string) {
	return `${count} ${count === 1 ? singular : `${singular}s`}`;
}
