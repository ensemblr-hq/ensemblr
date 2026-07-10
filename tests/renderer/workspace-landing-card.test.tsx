import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import { WorkspaceLandingCard } from '../../src/renderer/components/workbench-shell/conversation-panel';
import type { WorkspaceLandingSummary } from '../../src/renderer/types/workbench';

function renderCard(landingSummary: WorkspaceLandingSummary | null) {
	return renderToStaticMarkup(
		<WorkspaceLandingCard landingSummary={landingSummary} />,
	);
}

test('local-branch landing card surfaces repo name, branch, and copied count', () => {
	const markup = renderCard({
		branchSource: {
			baseBranch: 'origin/master',
			branchName: 'psoldunov/stockholm',
			detail: 'Worktree branched from master.',
		},
		copiedFiles: {
			count: 665,
			detail: 'Copied 665 local-only files from repository.',
			state: 'copied',
		},
		headline: 'New workspace ready',
		kind: 'local-branch',
		repositoryName: 'ensemblr',
		setupGuidance: {
			detail: 'No setup script is configured for this repository.',
			state: 'missing',
		},
		workspaceName: 'stockholm',
	});

	expect(markup).toContain('Workspace landing summary');
	expect(markup).toContain('data-landing-card-kind="local-branch"');
	expect(markup).toContain('ensemblr');
	expect(markup).toContain('stockholm');
	expect(markup).toContain('psoldunov/stockholm');
	expect(markup).toContain('origin/master');
	expect(markup).toContain('665');
	expect(markup).toContain('Branched');
	expect(markup).toContain('Created');
	expect(markup).toContain('copied');
	expect(markup).not.toContain('Pi composer not ready');
	expect(markup).not.toContain('Add a setup script');
	expect(markup).not.toContain('Linked issue');
});

test('cloned-repo landing card omits base-branch suffix when not provided', () => {
	const markup = renderCard({
		branchSource: {
			branchName: 'main',
			detail: 'Fresh clone checked out the default branch.',
		},
		copiedFiles: {
			count: 0,
			detail: 'No local-only files were available to copy from the source.',
			state: 'skipped',
		},
		headline: 'Repository cloned',
		kind: 'cloned-repo',
		repositoryName: 'monrovia',
		setupGuidance: {
			detail: 'Run the configured setup script to bootstrap dependencies.',
			state: 'configured',
		},
		workspaceName: 'main',
	});

	expect(markup).toContain('data-landing-card-kind="cloned-repo"');
	expect(markup).toContain('monrovia');
	expect(markup).toContain('main');
	expect(markup).toContain('0');
	expect(markup).not.toContain('from <');
	expect(markup).not.toContain('bun install');
});

test('omits the landing card when no summary is provided', () => {
	const markup = renderCard(null);

	expect(markup).toBe('');
});
