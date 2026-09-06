// @vitest-environment happy-dom

import { getDefaultStore } from 'jotai';
import { act } from 'react';
import { afterEach, expect, test } from 'vitest';

import { SidebarProvider } from '../../src/renderer/components/ui/sidebar';
import { WorkspaceNavigationSidebar } from '../../src/renderer/components/workbench-shell/navigation-sidebar/navigation-sidebar';
import { NavigationProvider } from '../../src/renderer/components/workbench-shell/shell-contexts';
import { readWindowChrome } from '../../src/renderer/lib/window-chrome';
import { windowChromeAtom } from '../../src/renderer/state/window-chrome';
import type { WorkbenchRouteSearch } from '../../src/renderer/types/workbench';
import type {
	ProjectNavigationState,
	WorkbenchHealth,
} from '../../src/renderer/types/workbench-shell';
import type { WindowChromeSnapshot } from '../../src/shared/window-chrome';
import { resolveWindowChrome } from '../../src/shared/window-chrome';
import { renderWithProviders } from './support/dom';

const WORDMARK = '[data-slot="ensemblr-wordmark"]';

const store = getDefaultStore();

const health: WorkbenchHealth = {
	detail: 'Everything responding.',
	label: 'Online',
	state: 'online',
};

const projectNavigation: ProjectNavigationState = {
	collapsedProjectIdSet: new Set(),
	orderedProjects: [],
	pinnedWorkspaceEntries: [],
	pinnedWorkspaceIdSet: new Set(),
	reorderProjects: () => undefined,
	toggleProjectCollapsed: () => undefined,
	toggleWorkspacePinned: () => undefined,
};

afterEach(() => {
	store.set(windowChromeAtom, readWindowChrome());
});

/**
 * Renders the sidebar with the given chrome in the store, on an empty project
 * list so the header strip is the only thing that varies.
 * @param chrome - The chrome the window is wearing.
 * @returns The rendered container.
 */
function renderSidebar(chrome: WindowChromeSnapshot): HTMLElement {
	store.set(windowChromeAtom, chrome);

	const { container } = renderWithProviders(
		<SidebarProvider>
			<NavigationProvider
				value={{ renderStaticLink: undefined, renderWorkspaceLink: undefined }}
			>
				<WorkspaceNavigationSidebar
					activeProject={null}
					activeView='dashboard'
					activeWorkspace={null}
					health={health}
					onStaticNavigationSelect={() => undefined}
					onWorkspaceSelect={() => undefined}
					projectNavigation={projectNavigation}
					projects={[]}
					resolveWorkspaceRouteSearch={() => ({}) as WorkbenchRouteSearch}
				/>
			</NavigationProvider>
		</SidebarProvider>,
	);
	return container;
}

test('macOS windowed leaves the corner to the traffic lights', () => {
	const container = renderSidebar(resolveWindowChrome('darwin', 'system'));

	expect(container.querySelector(WORDMARK)).toBeNull();
});

test('macOS full screen hands the freed corner to the wordmark', () => {
	const container = renderSidebar(
		resolveWindowChrome('darwin', 'system', true),
	);

	expect(container.querySelector(WORDMARK)).not.toBeNull();
});

// The whole point of the atom: a snapshot arriving after mount has to move the
// strip, which the one-shot bootstrap read it replaced could never do.
test('a snapshot arriving after mount is what makes the wordmark appear', () => {
	const container = renderSidebar(resolveWindowChrome('darwin', 'system'));

	expect(container.querySelector(WORDMARK)).toBeNull();

	act(() => {
		store.set(windowChromeAtom, resolveWindowChrome('darwin', 'system', true));
	});

	expect(container.querySelector(WORDMARK)).not.toBeNull();
});

test('the strip is gone entirely where Ensemblr draws its own title bar', () => {
	const container = renderSidebar(resolveWindowChrome('linux', 'custom'));

	expect(container.querySelector(WORDMARK)).toBeNull();
	expect(container.querySelector('.window-chrome-spacer')).toBeNull();
});
