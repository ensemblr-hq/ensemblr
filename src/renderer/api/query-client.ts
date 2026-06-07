import { QueryClient } from '@tanstack/react-query';

/** Singleton TanStack Query client for the renderer, with conservative defaults. */
export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: 1,
			refetchOnWindowFocus: false,
		},
	},
});
