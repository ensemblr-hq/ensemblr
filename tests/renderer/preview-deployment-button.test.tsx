// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { PreviewDeploymentButton } from '../../src/renderer/components/workbench-shell/right-sidebar-header/preview-deployment-button';

test('colors the preview pill from its deployment status', () => {
	render(
		<PreviewDeploymentButton
			deployment={{
				label: 'Preview',
				provider: 'vercel',
				source: 'github-deployment',
				status: 'blocked',
				url: 'https://blocked-preview.vercel.app',
			}}
		/>,
	);

	const link = screen.getByRole('link', {
		name: 'Open Vercel preview deployment',
	});
	expect(link.className).toContain('border-status-danger/35');
	expect(link.className).not.toContain('border-status-ok/35');
});
