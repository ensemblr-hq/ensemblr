import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import '@/renderer/styles/index.css';

import { installPlaygroundBridge } from './bridge.ts';
import { Playground } from './playground.tsx';

const rootElement = document.getElementById('root');

if (!rootElement) {
	throw new Error('Ensemblr playground root element was not found.');
}

installPlaygroundBridge();

const queryClient = new QueryClient({
	defaultOptions: {
		queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
	},
});

createRoot(rootElement).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<Playground />
			</TooltipProvider>
		</QueryClientProvider>
	</StrictMode>,
);
