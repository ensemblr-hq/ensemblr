/**
 * Single home for all workbench-shell React contexts. Each context uses the
 * `makeShellContext` factory so adding a new one is one line, not a 28-line
 * copy of the createContext/Provider/use trio.
 */
import { createContext, type ReactElement, type ReactNode, use } from 'react';

import type { WorkspaceNavigationSelection } from '@/renderer/lib/workbench';
import type { WorkspaceMainContentState } from '@/renderer/types/components';
import type {
	NavigationContextValue,
	SetupDiagnosticsContextValue,
	WorkbenchLayoutContextValue,
} from '@/renderer/types/contexts';
import type {
	AddProjectActionId,
	AddProjectMenuModel,
	ProjectShellModel,
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type {
	WorkbenchHealth,
	WorkbenchStaticNavigationTarget,
} from '@/renderer/types/workbench-shell';

/** Result shape of {@link makeShellContext}. */
interface ShellContext<T> {
	Provider: (props: { value: T; children: ReactNode }) => ReactElement;
	use: () => T;
	/** Non-throwing accessor — returns `null` when no provider is mounted. */
	useOptional: () => T | null;
}

/**
 * Wraps `createContext` + Provider + throwing `use*()` hook in one call.
 * `name` is interpolated into the error message thrown when consumers read
 * the context outside its provider.
 */
function makeShellContext<T>(name: string): ShellContext<T> {
	const Context = createContext<T | null>(null);

	/** Mounts the context, exposing `value` to descendant consumers. */
	function Provider({
		value,
		children,
	}: {
		value: T;
		children: ReactNode;
	}): ReactElement {
		return <Context.Provider value={value}>{children}</Context.Provider>;
	}

	/**
	 * Reads the context value, throwing when used outside its provider.
	 * @returns The current context value
	 */
	function useValue(): T {
		const value = use(Context);
		if (value === null) {
			throw new Error(`${name} must be used within ${name}Provider`);
		}
		return value;
	}

	/**
	 * Reads the context value without throwing when no provider is mounted.
	 * @returns The context value, or `null` outside a provider
	 */
	function useOptional(): T | null {
		return use(Context);
	}

	return { Provider, use: useValue, useOptional };
}

const LayoutContext =
	makeShellContext<WorkbenchLayoutContextValue>('useWorkbenchLayout');
export const WorkbenchLayoutProvider = LayoutContext.Provider;
export const useWorkbenchLayout = LayoutContext.use;

const NavigationContext =
	makeShellContext<NavigationContextValue>('useNavigation');
export const NavigationProvider = NavigationContext.Provider;
export const useNavigation = NavigationContext.use;

const SetupDiagnosticsContext = makeShellContext<SetupDiagnosticsContextValue>(
	'useSetupDiagnostics',
);
export const SetupDiagnosticsProvider = SetupDiagnosticsContext.Provider;
export const useSetupDiagnostics = SetupDiagnosticsContext.use;
/** Non-throwing variant for shell chrome that may render in isolation. */
export const useSetupDiagnosticsOptional = SetupDiagnosticsContext.useOptional;

/** Layout model exposed below the `_shell` route. */
export interface WorkbenchLayoutModel {
	activeProject: ProjectShellModel | null;
	activeWorkspace: WorkspaceShellModel | null;
	addProjectMenu: AddProjectMenuModel;
	displayProjects: ProjectShellModel[];
	displaySelection: WorkspaceNavigationSelection | null;
	health: WorkbenchHealth;
	navigateToStaticRoute: (target: WorkbenchStaticNavigationTarget) => void;
	navigateToWorkspace: (projectId: string, workspaceId: string) => void;
	onAddProject: (id: AddProjectActionId) => void;
	resolveWorkspaceRouteSearch: (
		workspace: WorkspaceShellModel,
	) => WorkbenchRouteSearch;
}

const LayoutModelContext = makeShellContext<WorkbenchLayoutModel>(
	'useWorkbenchLayoutRouteModel',
);
export const WorkbenchLayoutModelProvider = LayoutModelContext.Provider;
export const useWorkbenchLayoutRouteModel = LayoutModelContext.use;

const WorkspaceMainContentCtx = makeShellContext<WorkspaceMainContentState>(
	'useWorkspaceMainContent',
);
export const WorkspaceMainContentProvider = WorkspaceMainContentCtx.Provider;
export const useWorkspaceMainContent = WorkspaceMainContentCtx.use;
