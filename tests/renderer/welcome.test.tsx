import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

import {
	Sidebar,
	SidebarProvider,
} from '../../src/renderer/components/ui/sidebar';
import { Welcome } from '../../src/renderer/components/welcome';

vi.mock('@tanstack/react-router', async () => {
	const actual = await vi.importActual<typeof import('@tanstack/react-router')>(
		'@tanstack/react-router',
	);

	return {
		...actual,
		useNavigate: () => () => undefined,
		useRouter: () => ({}),
	};
});

test('keeps a sidebar expand trigger available on the collapsed welcome screen', () => {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	const markup = renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<SidebarProvider open={false} onOpenChange={() => undefined}>
				<Sidebar collapsible='offcanvas' />
				<Welcome />
			</SidebarProvider>
		</QueryClientProvider>,
	);

	expect(markup).toContain('data-state="collapsed"');
	expect(markup).toContain('data-slot="sidebar-inset"');
	expect(markup).toContain('sidebar-collapsed-trigger');
	expect(markup).toContain('Toggle Sidebar');
});
