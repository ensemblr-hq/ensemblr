import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { WorkspaceLandingCard } from '../../src/renderer/components/workbench-shell/conversation-panel';
import type {
	ComposerShellState,
	WorkspaceLandingSummary,
} from '../../src/renderer/types/workbench';

const COMPOSER_DEFAULTS = {
	availableModels: [],
	availableThinkingLevels: [],
	isStreaming: false,
	modelId: 'gpt-5.5',
	onModelChange: () => undefined,
	onStop: () => undefined,
	onSubmit: () => undefined,
	onThinkingChange: () => undefined,
	thinkingLevel: 'high',
} as const;

const READY_COMPOSER: ComposerShellState = {
	...COMPOSER_DEFAULTS,
	disabled: false,
	disabledReason: null,
	modelLabel: 'GPT-5.5 via Pi',
	placeholder: 'Ask Pi to continue review shell',
	thinkingLabel: 'High',
};

const BLOCKED_COMPOSER: ComposerShellState = {
	...COMPOSER_DEFAULTS,
	disabled: true,
	disabledReason: '3 required setup checks need attention.',
	modelLabel: 'Pi model pending',
	placeholder: 'Fix setup blockers before sending a prompt.',
	thinkingLabel: 'Thinking pending',
};

const DEFAULT_NAME = 'New landing fixture';
const DEFAULT_PATH = '~/Ensemble/workspaces/ensemble/new-landing';

function renderCard(
	landingSummary: WorkspaceLandingSummary | null,
	composer: ComposerShellState = READY_COMPOSER,
) {
	return renderToStaticMarkup(
		<WorkspaceLandingCard
			composer={composer}
			landingSummary={landingSummary}
			name={DEFAULT_NAME}
			pathLabel={DEFAULT_PATH}
		/>,
	);
}

test('local-branch landing card surfaces branch source and missing setup script guidance', () => {
	const markup = renderCard({
		branchSource: {
			baseBranch: 'master',
			branchName: 'philipp/the-123-landing',
			detail: 'Worktree branched from master.',
		},
		copiedFiles: {
			count: 3,
			detail: 'Copied .env.local, .npmrc, and .agents config from repository.',
			state: 'copied',
		},
		headline: 'New workspace ready',
		kind: 'local-branch',
		setupGuidance: {
			detail: 'No setup script is configured for this repository.',
			state: 'missing',
		},
	});

	expect(markup).toContain('Workspace landing summary');
	expect(markup).toContain('data-landing-card-kind="local-branch"');
	expect(markup).toContain('New workspace ready');
	expect(markup).toContain('philipp/the-123-landing');
	expect(markup).toContain('master');
	expect(markup).toContain('3');
	expect(markup).toContain('files copied');
	expect(markup).toContain('Add a setup script');
	expect(markup).toContain('No setup script is configured');
	expect(markup).toContain('data-landing-composer-state="ready"');
	expect(markup).not.toContain('Linked issue');
	expect(markup).not.toContain('Pi composer not ready');
});

test('cloned-repo landing card shows clone-specific copy and run-script command', () => {
	const markup = renderCard({
		branchSource: {
			baseBranch: 'main',
			branchName: 'main',
			detail: 'Fresh clone checked out the default branch.',
		},
		copiedFiles: {
			count: 0,
			detail:
				'No local-only files were available to copy from the source clone.',
			state: 'skipped',
		},
		headline: 'Repository cloned',
		kind: 'cloned-repo',
		setupGuidance: {
			command: 'bun install',
			detail: 'Run the configured setup script to bootstrap dependencies.',
			state: 'configured',
		},
	});

	expect(markup).toContain('data-landing-card-kind="cloned-repo"');
	expect(markup).toContain('Repository cloned');
	expect(markup).toContain('Fresh clone checked out the default branch.');
	expect(markup).toContain('files skipped');
	expect(markup).toContain('Configured');
	expect(markup).toContain('bun install');
	expect(markup).not.toContain('files copied');
});

test('linear-linked landing card shows linked issue metadata and composer-blocked notice', () => {
	const markup = renderCard(
		{
			branchSource: {
				baseBranch: 'master',
				branchName: 'philipp/the-148-from-linear',
				detail: 'Worktree branched from master.',
			},
			copiedFiles: {
				count: 5,
				detail: 'Copied editor and CLI dotfiles from repository.',
				state: 'copied',
			},
			headline: 'Workspace seeded from Linear issue',
			kind: 'linked-issue',
			linkedIssue: {
				provider: 'linear',
				reference: 'THE-148',
				subtitle: 'Ensemble · Todo',
				title: 'Workspace creation from Linear issue',
				url: 'https://linear.app/theswisscheese/issue/THE-148',
			},
			setupGuidance: {
				command: 'bun install',
				detail: 'Configured setup script has not run yet.',
				state: 'pending',
			},
		},
		BLOCKED_COMPOSER,
	);

	expect(markup).toContain('data-landing-card-kind="linked-issue"');
	expect(markup).toContain('Workspace seeded from Linear issue');
	expect(markup).toContain('Linked issue');
	expect(markup).toContain('THE-148');
	expect(markup).toContain('linear');
	expect(markup).toContain('Workspace creation from Linear issue');
	expect(markup).toContain('Ensemble · Todo');
	expect(markup).toContain('Not run yet');
	expect(markup).toContain('data-landing-composer-state="disabled"');
	expect(markup).toContain('Pi composer not ready');
	expect(markup).toContain('3 required setup checks need attention.');
});

test('omits the landing card when no summary is provided', () => {
	const markup = renderCard(null);

	expect(markup).toBe('');
});
