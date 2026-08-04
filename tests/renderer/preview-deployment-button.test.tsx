// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { PreviewDeploymentButton } from '../../src/renderer/components/workbench-shell/right-sidebar-header/preview-deployment-button';
import { PullRequestNumberButton } from '../../src/renderer/components/workbench-shell/right-sidebar-header/pull-request-number-button';

test('colors the preview pill from the header tone, not the deployment status', () => {
	render(
		<PreviewDeploymentButton
			deployment={{
				label: 'Preview',
				provider: 'vercel',
				source: 'github-deployment',
				status: 'ready',
				url: 'https://ready-preview.vercel.app',
			}}
			tone='pending'
		/>,
	);

	const link = screen.getByRole('link', {
		name: 'Open Vercel preview deployment',
	});
	expect(link.className).toContain('border-status-warning/55');
	expect(link.className).not.toContain('border-status-ok/35');
});

test('renders the neutral header tone for an open pull request', () => {
	render(
		<PreviewDeploymentButton
			deployment={{
				label: 'Preview',
				provider: 'vercel',
				source: 'github-deployment',
				status: 'ready',
				url: 'https://ready-preview.vercel.app',
			}}
			tone='neutral'
		/>,
	);

	const link = screen.getByRole('link', {
		name: 'Open Vercel preview deployment',
	});
	expect(link.className).toContain('border-border');
	expect(link.className).toContain('text-muted-foreground');
	expect(link.className).not.toContain('border-status-ok/35');
});

test('renders the merged header tone after the pull request lands', () => {
	render(
		<PreviewDeploymentButton
			deployment={{
				label: 'Preview',
				provider: 'vercel',
				source: 'github-deployment',
				status: 'ready',
				url: 'https://ready-preview.vercel.app',
			}}
			tone='merged'
		/>,
	);

	const link = screen.getByRole('link', {
		name: 'Open Vercel preview deployment',
	});
	expect(link.className).toContain(
		'border-[color:var(--right-sidebar-header-merged)]',
	);
	expect(link.className).not.toContain('border-status-ok/35');
});

test('keeps a failed deployment red under a green header tone', () => {
	render(
		<PreviewDeploymentButton
			deployment={{
				label: 'Preview',
				provider: 'vercel',
				source: 'github-deployment',
				status: 'blocked',
				url: 'https://blocked-preview.vercel.app',
			}}
			tone='ready'
		/>,
	);

	const link = screen.getByRole('link', {
		name: 'Open Vercel preview deployment',
	});
	expect(link.className).toContain('border-status-danger/35');
	expect(link.className).not.toContain('border-status-ok/35');
});

test('renders the same pill classes as the pull request button for one tone', () => {
	render(
		<>
			<PullRequestNumberButton
				number={196}
				tone='blocked'
				url='https://github.com/owner/repo/pull/196'
			/>
			<PreviewDeploymentButton
				deployment={{
					label: 'Preview',
					provider: 'netlify',
					source: 'pr-comment',
					status: 'ready',
					url: 'https://ready-preview.netlify.app',
				}}
				tone='blocked'
			/>
		</>,
	);

	const pullRequestLink = screen.getByRole('link', {
		name: 'Open pull request #196',
	});
	const previewLink = screen.getByRole('link', {
		name: 'Open Netlify preview deployment',
	});
	expect(previewLink.className).toBe(pullRequestLink.className);
	expect(previewLink.className).toContain('border-status-danger/35');
});
