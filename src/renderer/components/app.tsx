import { Outlet } from '@tanstack/react-router';

import { useThemeEffect } from '@/renderer/state/preferences/use-theme-effect';

/** Root app component — delegates rendering to the active TanStack Router outlet. */
export function App() {
	useThemeEffect();
	return <Outlet />;
}
