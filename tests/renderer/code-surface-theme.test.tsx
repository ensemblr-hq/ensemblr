// @vitest-environment happy-dom
import { render, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { CodePanel } from '../../src/renderer/components/code-surface';
import { ToolPanel } from '../../src/renderer/components/tool-collapsible/tool-panel';
import {
	codeThemeAtom,
	useResolvedCodeTheme,
} from '../../src/renderer/state/preferences';
import { clearEnsemblrApi, installEnsemblrApi } from './support/dom';

const CODE = 'export const answer = 42;\nconsole.log(answer);\n';

afterEach(() => {
	clearEnsemblrApi();
	document.documentElement.classList.remove('dark', 'light');
});

function ResolvedTheme() {
	return <output>{useResolvedCodeTheme()}</output>;
}

function renderPanel(theme: 'catppuccin-latte' | 'catppuccin-mocha') {
	installEnsemblrApi({ updateAppSettings: vi.fn(async () => ({})) });
	const store = createStore();
	store.set(codeThemeAtom, theme);
	return render(
		<Provider store={store}>
			<CodePanel code={CODE} copyable language='typescript' />
		</Provider>,
	);
}

describe('code surfaces under a picked syntax theme', () => {
	test('paints its background from the app code token even for a light theme', () => {
		const { container } = renderPanel('catppuccin-latte');
		const surface = container.querySelector('.bg-code');

		expect(surface).not.toBeNull();
		expect(surface?.getAttribute('class')).toContain('text-code-foreground');
		expect(surface?.getAttribute('style') ?? '').not.toContain(
			'background-color',
		);
	});

	test('leaves syntax colours to the picked theme', async () => {
		const { container } = renderPanel('catppuccin-mocha');

		await waitFor(
			() => {
				const colored = container.querySelectorAll('span[style*="color"]');
				expect(colored.length).toBeGreaterThan(0);
			},
			{ timeout: 8000 },
		);
	}, 12000);

	test('follows the root theme class when picking the cut to highlight with', async () => {
		document.documentElement.classList.add('dark');
		const { getByRole } = render(<ResolvedTheme />);

		expect(getByRole('status').textContent).toBe('catppuccin-mocha');

		document.documentElement.classList.replace('dark', 'light');

		await waitFor(() => {
			expect(getByRole('status').textContent).toBe('catppuccin-latte');
		});
	});

	test('puts plain tool payloads on the same app-owned surface', () => {
		const { container } = render(<ToolPanel>payload</ToolPanel>);
		const panel = container.querySelector('.bg-code');

		expect(panel).not.toBeNull();
		expect(panel?.getAttribute('style') ?? '').not.toContain(
			'background-color',
		);
	});
});
