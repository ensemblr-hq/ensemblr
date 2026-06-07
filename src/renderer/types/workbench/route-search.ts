import type { DockTabId } from './dock-tabs';
import type { ReviewPanelTab } from './review';

export interface WorkbenchRouteSearch {
	dock?: DockTabId;
	review?: ReviewPanelTab;
}
