import { Outlet } from '@tanstack/react-router';

/** Root app component — delegates rendering to the active TanStack Router outlet. */
export function App() {
	return <Outlet />;
}
