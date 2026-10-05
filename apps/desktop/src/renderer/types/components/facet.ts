/**
 * Classes a host applies to collapse a facet trigger to its icon when it runs
 * short of room: one hides the text label, the other reveals the selection
 * count in its place, so the row still says a filter is active.
 */
export interface FacetCollapse {
	hideLabel: string;
	showCount: string;
}
