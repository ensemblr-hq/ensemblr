// @vitest-environment happy-dom

import { render } from '@testing-library/react';
import { act, type ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const { mergeConfirmationDialog, reviewActionsSeen } = vi.hoisted(() => ({
	mergeConfirmationDialog: vi.fn(),
	reviewActionsSeen: [] as { openMergeConfirmation: () => void }[],
}));

vi.mock(
	'@/renderer/components/workbench-shell/review-actions/merge-confirmation-dialog',
	() => ({
		MergeConfirmationDialog: (props: { open: boolean }) => {
			mergeConfirmationDialog(props);
			return null;
		},
	}),
);

vi.mock(
	'@/renderer/components/workbench-shell/review-actions/review-actions-context',
	() => ({
		ReviewActionsContextProvider: ({
			children,
			value,
		}: {
			children: ReactNode;
			value: { openMergeConfirmation: () => void };
		}) => {
			reviewActionsSeen.push(value);
			return children;
		},
	}),
);

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: null }) }));

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	reviewMergeSettingsQuery: () => ({ queryKey: ['merge-settings'] }),
}));

vi.mock(
	'@/renderer/hooks/workbench-shell/review-actions/use-pull-request-refresh',
	() => ({
		usePullRequestRefresh: () => ({
			isRefreshingPullRequest: false,
			refreshPullRequest: vi.fn(),
		}),
	}),
);

vi.mock(
	'@/renderer/hooks/workbench-shell/review-actions/use-review-menu-commands',
	() => ({ useReviewMenuCommands: vi.fn() }),
);

vi.mock(
	'@/renderer/hooks/workbench-shell/review-actions/use-review-mutations',
	() => ({
		useReviewMutations: () => ({
			archiveMergedWorkspace: vi.fn(),
			continueMergedWorkspace: vi.fn(),
			isArchivingMergedWorkspace: false,
			isContinuingMergedWorkspace: false,
			isMerging: false,
			isPushingBranch: false,
			merge: vi.fn(),
			pushBranch: vi.fn(),
		}),
	}),
);

vi.mock('@/renderer/hooks/workspace/use-workspace-busy', () => ({
	useWorkspaceBusy: () => false,
}));

vi.mock('react-i18next', () => ({
	useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('sonner', () => ({
	toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

import { ReviewActionsProvider } from '@/renderer/components/workbench-shell/review-actions/review-actions-provider';
import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

const activeProject = {
	id: 'monteverdi',
	pathLabel: '/tmp/monteverdi',
} as unknown as ProjectShellModel;

const sanAntonio = {
	id: 'san-antonio',
	pathLabel: '/tmp/san-antonio',
	pullRequest: { number: 7, state: 'open', status: 'ready-to-merge' },
} as unknown as WorkspaceShellModel;

const houston = {
	id: 'houston',
	pathLabel: '/tmp/houston',
	pullRequest: { number: 9, state: 'open', status: 'ready-to-merge' },
} as unknown as WorkspaceShellModel;

/** Renders the provider for one workspace, returning the rerender handle. */
function renderProvider(workspace: WorkspaceShellModel) {
	const element = (target: WorkspaceShellModel) => (
		<ReviewActionsProvider
			activeProject={activeProject}
			activeWorkspace={target}
			handOffToChat={() => true}
			runAgentAction={vi.fn()}
		>
			<span />
		</ReviewActionsProvider>
	);
	const { rerender } = render(element(workspace));
	return { rerender: (next: WorkspaceShellModel) => rerender(element(next)) };
}

/** The `open` prop the dialog was last rendered with. */
function dialogIsOpen(): boolean {
	const lastCall = mergeConfirmationDialog.mock.lastCall;
	return lastCall?.[0].open === true;
}

/** Fires the context's `openMergeConfirmation` from the latest published value. */
function openMergeConfirmation(): void {
	const latest = reviewActionsSeen.at(-1);
	act(() => {
		latest?.openMergeConfirmation();
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	reviewActionsSeen.length = 0;
});

test('opens the merge confirmation for the workspace it was raised on', () => {
	renderProvider(sanAntonio);

	expect(dialogIsOpen()).toBe(false);
	openMergeConfirmation();

	expect(dialogIsOpen()).toBe(true);
});

test('abandons an open merge confirmation when the shell leaves the workspace', () => {
	const { rerender } = renderProvider(sanAntonio);
	openMergeConfirmation();

	act(() => {
		rerender(houston);
	});

	expect(dialogIsOpen()).toBe(false);
});

test('does not reopen an abandoned merge confirmation on the way back', () => {
	const { rerender } = renderProvider(sanAntonio);
	openMergeConfirmation();

	act(() => {
		rerender(houston);
	});
	act(() => {
		rerender(sanAntonio);
	});

	expect(dialogIsOpen()).toBe(false);
});

test('never renders the dialog open against a workspace it was not raised on', () => {
	const { rerender } = renderProvider(sanAntonio);
	openMergeConfirmation();
	mergeConfirmationDialog.mockClear();

	act(() => {
		rerender(houston);
	});

	for (const [props] of mergeConfirmationDialog.mock.calls) {
		expect(props.open && props.workspace.id === 'houston').toBe(false);
	}
});
