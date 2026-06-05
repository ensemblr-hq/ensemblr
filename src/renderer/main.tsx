import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import '@fontsource-variable/jetbrains-mono/wght.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { queryClient } from './query-client';
import { router } from './router';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
	throw new Error('Ensemble renderer root element was not found.');
}

createRoot(rootElement).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	</StrictMode>,
);
