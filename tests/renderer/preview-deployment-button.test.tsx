// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { PreviewDeploymentButton } from '../../src/renderer/components/workbench-shell/right-sidebar-header/preview-deployment-button';
import { PullRequestNumberButton } from '../../src/renderer/components/workbench-shell/right-sidebar-header/pull-request-number-button';

test('drops a generic Preview label but keeps it in the accessible name', () => {
	render(
		<PreviewDeploymentButton
			deployment={{
				label: 'Preview',
				provider: 'vercel',
				source: 'github-deployment',
				status: 'ready',
				url: 'https://ready-preview.vercel.app',
			}}
			tone='ready'
		/>,
	);

	const link = screen.getByRole('link', {
		name: 'Open Vercel preview deployment',
	});
	expect(link).not.toHaveTextContent('Preview');
	expect(link.querySelector('svg')).not.toBeNull();
});

test('keeps an environment label the provider mark cannot convey', () => {
	render(
		<PreviewDeploymentButton
			deployment={{
				label: 'staging',
				provider: 'vercel',
				source: 'github-deployment',
				status: 'ready',
				url: 'https://staging-preview.vercel.app',
			}}
			tone='ready'
		/>,
	);

	expect(
		screen.getByRole('link', { name: 'Open Vercel preview deployment' }),
	).toHaveTextContent('staging');
});

test('keeps a generic label when no provider mark can stand in for it', () => {
	render(
		<PreviewDeploymentButton
			deployment={{
				label: 'Preview',
				provider: 'unknown',
				source: 'pr-comment',
				status: 'ready',
				url: 'https://preview.example.com',
			}}
			tone='ready'
		/>,
	);

	expect(
		screen.getByRole('link', { name: 'Open preview deployment' }),
	).toHaveTextContent('Preview');
});

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

test('keeps a still-building deployment amber under a green header tone', () => {
	render(
		<PreviewDeploymentButton
			deployment={{
				label: 'Preview',
				provider: 'vercel',
				source: 'github-deployment',
				status: 'pending',
				url: 'https://building-preview.vercel.app',
			}}
			tone='ready'
		/>,
	);

	const link = screen.getByRole('link', {
		name: 'Open Vercel preview deployment',
	});
	expect(link.className).toContain('border-status-warning/55');
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
