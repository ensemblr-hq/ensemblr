import { createContext, type ReactNode, use } from 'react';

import type { NavigationContextValue } from '@/renderer/types/contexts';

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function NavigationProvider({
	value,
	children,
}: {
	value: NavigationContextValue;
	children: ReactNode;
}) {
	return (
		<NavigationContext.Provider value={value}>
			{children}
		</NavigationContext.Provider>
	);
}

export function useNavigation(): NavigationContextValue {
	const value = use(NavigationContext);
	if (value === null) {
		throw new Error('useNavigation must be used within a NavigationProvider');
	}
	return value;
}
