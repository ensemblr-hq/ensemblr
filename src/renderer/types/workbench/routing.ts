import type { DockTabId, ReviewPanelTab } from './workspace';

export interface WorkbenchRouteSearch {
	dock?: DockTabId;
	review?: ReviewPanelTab;
}
