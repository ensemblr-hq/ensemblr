import { Provider as JotaiProvider } from 'jotai';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
	throw new Error('Piductor renderer root element was not found.');
}

createRoot(rootElement).render(
	<StrictMode>
		<JotaiProvider>
			<App />
		</JotaiProvider>
	</StrictMode>,
);
