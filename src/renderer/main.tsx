import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import '@fontsource-variable/jetbrains-mono/wght.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { queryClient } from './api/query-client';
import { Toaster } from './components/ui/sonner';
import { router } from './routing/router';
import './styles/index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
	throw new Error('Ensemble renderer root element was not found.');
}

createRoot(rootElement).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
			<Toaster position='bottom-right' />
		</QueryClientProvider>
	</StrictMode>,
);
