import { createContext, type ReactNode, use } from 'react';

import type { WorkbenchLayoutContextValue } from '@/renderer/types/contexts';

const WorkbenchLayoutContext =
	createContext<WorkbenchLayoutContextValue | null>(null);

export function WorkbenchLayoutProvider({
	value,
	children,
}: {
	value: WorkbenchLayoutContextValue;
	children: ReactNode;
}) {
	return (
		<WorkbenchLayoutContext.Provider value={value}>
			{children}
		</WorkbenchLayoutContext.Provider>
	);
}

export function useWorkbenchLayout(): WorkbenchLayoutContextValue {
	const value = use(WorkbenchLayoutContext);
	if (value === null) {
		throw new Error(
			'useWorkbenchLayout must be used within a WorkbenchLayoutProvider',
		);
	}
	return value;
}
