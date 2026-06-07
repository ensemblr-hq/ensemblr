import { createContext, type ReactNode, use } from 'react';

import type { SetupDiagnosticsContextValue } from '@/renderer/types/contexts';

const SetupDiagnosticsContext =
	createContext<SetupDiagnosticsContextValue | null>(null);

export function SetupDiagnosticsProvider({
	value,
	children,
}: {
	value: SetupDiagnosticsContextValue;
	children: ReactNode;
}) {
	return (
		<SetupDiagnosticsContext.Provider value={value}>
			{children}
		</SetupDiagnosticsContext.Provider>
	);
}

export function useSetupDiagnostics(): SetupDiagnosticsContextValue {
	const value = use(SetupDiagnosticsContext);
	if (value === null) {
		throw new Error(
			'useSetupDiagnostics must be used within a SetupDiagnosticsProvider',
		);
	}
	return value;
}
