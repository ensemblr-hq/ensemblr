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
	expect(link).not.toHaveAttribute('title');
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

test('collapses the label to the provider mark in a narrow header', () => {
	render(
		<PreviewDeploymentButton
			deployment={{
				label: 'Preview – kast-calculator',
				provider: 'vercel',
				source: 'github-deployment',
				status: 'ready',
				url: 'https://kast-calculator.vercel.app',
			}}
			tone='merged'
		/>,
	);

	const link = screen.getByRole('link', {
		name: 'Open Vercel preview deployment',
	});
	expect(link).toHaveTextContent('Preview – kast-calculator');
	expect(link.querySelector('span')).toHaveClass('@max-xs/pr-header:hidden');
	expect(link).toHaveAttribute('title', 'Preview – kast-calculator');
});

test('never collapses a label the pill has no provider mark to fall back on', () => {
	render(
		<PreviewDeploymentButton
			deployment={{
				label: 'Preview – kast-calculator',
				provider: 'unknown',
				source: 'pr-comment',
				status: 'ready',
				url: 'https://kast-calculator.example.com',
			}}
			tone='merged'
		/>,
	);

	const link = screen.getByRole('link', {
		name: 'Open preview deployment',
	});
	expect(link.querySelector('svg')).toBeNull();
	expect(link.querySelector('span')).not.toHaveClass(
		'@max-xs/pr-header:hidden',
	);
	expect(link).not.toHaveAttribute('title');
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
	expect(link.className).toContain('border-status-danger/55');
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
	expect(previewLink.className).toContain('border-status-danger/55');
	expect(previewLink.className).toContain('dark:border-status-danger');
});
