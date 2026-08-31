// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { ReviewActionsContextProvider } from '../../src/renderer/components/workbench-shell/review-actions/review-actions-context';
import {
	RightSidebarHeader,
	RightSidebarHeaderInlineActions,
} from '../../src/renderer/components/workbench-shell/right-sidebar-header/right-sidebar-header';
import { getDefaultWorkspace } from '../../src/renderer/fixtures/workbench';
import type {
	ReviewActionsValue,
	WorkspaceShellModel,
} from '../../src/renderer/types/workbench';

import { installLocalStorage, renderWithProviders } from './support/dom';

const PR_HEADER_CONTAINER_SELECTOR = '[class~="@container/pr-header"]';

const { toastError, toastSuccess } = vi.hoisted(() => ({
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({
	toast: { error: toastError, success: toastSuccess },
}));

/** A review-actions value with every action stubbed, plus the given overrides. */
function stubReviewActions(
	overrides: Partial<ReviewActionsValue> = {},
): ReviewActionsValue {
	return {
		archiveMergedWorkspace: vi.fn(),
		commitAndPush: vi.fn(),
		continueMergedWorkspace: vi.fn(),
		handOffToChat: vi.fn(() => true),
		isAgentWorking: false,
		isArchivingMergedWorkspace: false,
		isContinuingMergedWorkspace: false,
		isPushingBranch: false,
		isRefreshingPullRequest: false,
		openMergeConfirmation: vi.fn(),
		pushBranch: vi.fn(),
		refreshPullRequest: vi.fn(),
		runAgentAction: vi.fn(),
		...overrides,
	};
}

/** An open PR carrying the given pull-request overrides. */
function workspaceWithPr(
	overrides: Partial<WorkspaceShellModel['pullRequest']>,
): WorkspaceShellModel {
	const base = getDefaultWorkspace();
	return {
		...base,
		pullRequest: {
			...base.pullRequest,
			number: 118,
			state: 'open',
			status: 'idle',
			...overrides,
		},
	};
}

/** An open PR whose branch carries commits the remote does not have. */
function workspaceWithUnpushedCommits(): WorkspaceShellModel {
	return workspaceWithPr({
		gitStatus: {
			actionLabel: 'Push',
			kind: 'unpushed',
			label: '2 unpushed commits',
			status: 'pending',
		},
	});
}

/** A workspace with no pull request and a clean branch. */
function workspaceWithoutPr(): WorkspaceShellModel {
	const base = getDefaultWorkspace();
	return {
		...base,
		changeSummary: { ...base.changeSummary, files: 0 },
		pullRequest: { ...base.pullRequest, number: undefined, status: 'idle' },
	};
}

/** Branch changes worth publishing, with no pull request open for them yet. */
function workspaceReadyForPr(): WorkspaceShellModel {
	const base = getDefaultWorkspace();
	return {
		...base,
		changeSummary: { ...base.changeSummary, files: 4 },
		pullRequest: { ...base.pullRequest, number: undefined, status: 'idle' },
	};
}

/** A ready Vercel deployment whose label is long enough to crowd a narrow header. */
function namedPreviewDeployment(): NonNullable<
	WorkspaceShellModel['pullRequest']['previewDeployment']
> {
	return {
		label: 'Preview – kast-calculator',
		provider: 'vercel',
		source: 'github-deployment',
		status: 'ready',
		url: 'https://kast-calculator.vercel.app',
	};
}

/** Renders the header under a stubbed review-actions context. */
function renderHeader(
	workspace: WorkspaceShellModel,
	reviewActions: ReviewActionsValue,
) {
	return renderWithProviders(
		<ReviewActionsContextProvider value={reviewActions}>
			<RightSidebarHeader activeWorkspace={workspace} />
		</ReviewActionsContextProvider>,
	);
}

/** Renders the collapsed-toolbar variant under a stubbed review-actions context. */
function renderInlineActions(
	workspace: WorkspaceShellModel,
	reviewActions: ReviewActionsValue,
) {
	return renderWithProviders(
		<ReviewActionsContextProvider value={reviewActions}>
			<RightSidebarHeaderInlineActions activeWorkspace={workspace} />
		</ReviewActionsContextProvider>,
	);
}

beforeEach(() => {
	installLocalStorage();
	toastError.mockClear();
	toastSuccess.mockClear();
});

test('an agent turn replaces every action with a spinner', () => {
	renderHeader(
		workspaceWithPr({ label: 'Ready to merge', status: 'ready-to-merge' }),
		stubReviewActions({ isAgentWorking: true }),
	);

	expect(screen.getByLabelText('Agent working')).toBeInTheDocument();
	expect(screen.queryByRole('button', { name: /merge/i })).toBeNull();
	expect(
		screen.queryByRole('button', { name: /pull request menu/i }),
	).toBeNull();
});

test('an idle ready PR still offers Merge', () => {
	renderHeader(
		workspaceWithPr({ label: 'Ready to merge', status: 'ready-to-merge' }),
		stubReviewActions(),
	);

	expect(screen.getByRole('button', { name: /merge/i })).toBeInTheDocument();
	expect(screen.queryByLabelText('Agent working')).toBeNull();
});

test('an uncommitted worktree hands the chore to the agent', async () => {
	const commitAndPush = vi.fn();
	const user = userEvent.setup();
	renderHeader(
		workspaceWithPr({
			gitStatus: {
				actionLabel: 'Commit and push',
				kind: 'uncommitted',
				label: '3 uncommitted changes',
				status: 'pending',
			},
			label: '2 checks failing',
			status: 'blocked',
		}),
		stubReviewActions({ commitAndPush }),
	);

	expect(screen.getByText('3 uncommitted changes')).toBeInTheDocument();
	await user.click(screen.getByRole('button', { name: 'Commit and push' }));
	expect(commitAndPush).toHaveBeenCalledOnce();
});

test('unpushed commits push directly, skipping the agent', async () => {
	const pushBranch = vi.fn();
	const user = userEvent.setup();
	renderHeader(
		workspaceWithUnpushedCommits(),
		stubReviewActions({ pushBranch }),
	);

	expect(screen.getByText('2 unpushed commits')).toBeInTheDocument();
	await user.click(screen.getByRole('button', { name: 'Push' }));
	expect(pushBranch).toHaveBeenCalledOnce();
});

test('the Push button waits on the push it started', () => {
	renderHeader(
		workspaceWithUnpushedCommits(),
		stubReviewActions({ isPushingBranch: true }),
	);

	expect(screen.getByRole('button', { name: 'Push' })).toBeDisabled();
});

test('a conflicting PR offers the resolve action in its overflow menu', async () => {
	const runAgentAction = vi.fn();
	const user = userEvent.setup();
	renderHeader(
		workspaceWithPr({
			isConflicting: true,
			label: 'Merge conflicts',
			status: 'blocked',
		}),
		stubReviewActions({ runAgentAction }),
	);

	expect(screen.getByText('Merge conflicts')).toBeInTheDocument();
	await user.click(
		screen.getByRole('button', { name: 'Open pull request menu' }),
	);
	// Merging cannot succeed until the conflicts are gone, so the menu offers the
	// resolve action in its place rather than alongside it.
	expect(screen.queryByRole('menuitem', { name: /^Merge/ })).toBeNull();
	await user.click(screen.getByRole('menuitem', { name: 'Resolve conflicts' }));
	expect(runAgentAction).toHaveBeenCalledWith('resolve-conflicts');
});

test('a PR blocked without conflicts hides the resolve action', async () => {
	const user = userEvent.setup();
	renderHeader(
		workspaceWithPr({ label: '2 checks failing', status: 'blocked' }),
		stubReviewActions(),
	);

	await user.click(
		screen.getByRole('button', { name: 'Open pull request menu' }),
	);
	expect(
		screen.queryByRole('menuitem', { name: 'Resolve conflicts' }),
	).toBeNull();
	// A failing check can still be merged past by someone with the rights to.
	expect(screen.getByRole('menuitem', { name: /^Merge/ })).toBeInTheDocument();
});

test('a merged PR offers Continue and Archive', () => {
	renderHeader(
		workspaceWithPr({ label: 'Merged', state: 'merged' }),
		stubReviewActions(),
	);

	expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
	expect(screen.getByRole('button', { name: /archive/i })).toBeEnabled();
});

test('either post-merge action in flight disables both', () => {
	renderHeader(
		workspaceWithPr({ label: 'Merged', state: 'merged' }),
		stubReviewActions({ isArchivingMergedWorkspace: true }),
	);

	expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
	expect(screen.getByRole('button', { name: /archive/i })).toBeDisabled();
});

// The draft path is the one that goes through `handOffToChat` rather than
// `runAgentAction`, so it is the one that breaks silently if the menu stops
// reaching the review-actions context.
test('Create draft PR hands the prompt to the chat agent', async () => {
	const handOffToChat = vi.fn<ReviewActionsValue['handOffToChat']>(() => true);
	const user = userEvent.setup();
	renderHeader(workspaceReadyForPr(), stubReviewActions({ handOffToChat }));

	await user.click(
		screen.getByRole('button', { name: 'Open create pull request options' }),
	);
	await user.click(screen.getByRole('menuitem', { name: 'Create draft PR' }));

	expect(handOffToChat).toHaveBeenCalledOnce();
	expect(handOffToChat).toHaveBeenCalledWith(expect.stringContaining('draft'));
});

test('a workspace with no chat ready says so instead of claiming the draft PR landed', async () => {
	const user = userEvent.setup();
	renderHeader(
		workspaceReadyForPr(),
		stubReviewActions({ handOffToChat: vi.fn(() => false) }),
	);

	await user.click(
		screen.getByRole('button', { name: 'Open create pull request options' }),
	);
	await user.click(screen.getByRole('menuitem', { name: 'Create draft PR' }));

	expect(toastError).toHaveBeenCalledWith(
		'This workspace has no chat ready yet. Try again in a moment.',
	);
	expect(toastSuccess).not.toHaveBeenCalled();
});

test('the collapsed toolbar stays silent on an idle workspace with no PR', () => {
	const { container } = renderInlineActions(
		workspaceWithoutPr(),
		stubReviewActions(),
	);

	expect(container).toBeEmptyDOMElement();
});

test('the collapsed toolbar still shows the spinner while an agent works', () => {
	renderInlineActions(
		workspaceWithoutPr(),
		stubReviewActions({ isAgentWorking: true }),
	);

	expect(screen.getByLabelText('Agent working')).toBeInTheDocument();
});

test('the sidebar header gives its pills the pr-header query container', () => {
	renderHeader(
		workspaceWithPr({ previewDeployment: namedPreviewDeployment() }),
		stubReviewActions(),
	);

	expect(
		screen
			.getByRole('link', { name: 'Open Vercel preview deployment' })
			.closest(PR_HEADER_CONTAINER_SELECTOR),
	).not.toBeNull();
});

test('the collapsed toolbar keeps the preview label, having no container to collapse against', () => {
	renderInlineActions(
		workspaceWithPr({ previewDeployment: namedPreviewDeployment() }),
		stubReviewActions(),
	);

	const link = screen.getByRole('link', {
		name: 'Open Vercel preview deployment',
	});
	expect(link.closest(PR_HEADER_CONTAINER_SELECTOR)).toBeNull();
	expect(link).toHaveTextContent('Preview – kast-calculator');
});
