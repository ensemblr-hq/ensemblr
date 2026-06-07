import type { ReactElement } from 'react';

import type {
	WorkbenchStaticNavigationTarget,
	WorkbenchWorkspaceNavigationLinkTarget,
} from '@/renderer/types/workbench-shell';

export type RenderStaticLink = (
	target: WorkbenchStaticNavigationTarget,
	content: ReactElement,
) => ReactElement;

export type RenderWorkspaceLink = (
	target: WorkbenchWorkspaceNavigationLinkTarget,
	content: ReactElement,
) => ReactElement;

export interface NavigationContextValue {
	renderStaticLink: RenderStaticLink | undefined;
	renderWorkspaceLink: RenderWorkspaceLink | undefined;
}
