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
	throw new Error('Ensemblr renderer root element was not found.');
}

// Tag the dev build (`bun run dev`) so `.env-dev` in index.css tints the top
// bars amber, visually separating it from the installed app during dogfooding.
// `import.meta.env.DEV` is a compile-time constant, so this is stripped from the
// packaged bundle. It mirrors the main process's `!app.isPackaged` state
// isolation (see main.ts); the two signals move together, so the amber tint
// always marks a window that is running isolated dev state.
if (import.meta.env.DEV) {
	document.documentElement.classList.add('env-dev');
}

createRoot(rootElement).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
			<Toaster position='bottom-right' />
		</QueryClientProvider>
	</StrictMode>,
);
