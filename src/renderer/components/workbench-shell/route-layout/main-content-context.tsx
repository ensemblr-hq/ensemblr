import { createContext, type ReactNode, use } from 'react';

import type { WorkspaceMainContentState } from '@/renderer/types/components';

const WorkspaceMainContentContext =
	createContext<WorkspaceMainContentState | null>(null);

export function WorkspaceMainContentProvider({
	value,
	children,
}: {
	value: WorkspaceMainContentState;
	children: ReactNode;
}) {
	return (
		<WorkspaceMainContentContext.Provider value={value}>
			{children}
		</WorkspaceMainContentContext.Provider>
	);
}

/** Consumes the workspace main-content context; throws when used outside the workspace route. */
export function useWorkspaceMainContent(): WorkspaceMainContentState {
	const value = use(WorkspaceMainContentContext);

	if (!value) {
		throw new Error(
			'Workspace main content is only available below the workspace route.',
		);
	}

	return value;
}
