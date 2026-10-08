// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MergeConfirmationDialog } from '@/renderer/components/workbench-shell/review-actions/merge-confirmation-dialog';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import { renderWithProviders } from './support/dom';

/** Builds the slice of a workspace the dialog reads, with an optional base branch. */
function workspaceWithBase(baseBranch?: string): WorkspaceShellModel {
	return {
		branchName: 'feature/x',
		landingSummary: baseBranch ? { branchSource: { baseBranch } } : undefined,
		pullRequest: {
			checks: [],
			comments: [],
			number: 9,
			status: 'ready-to-merge',
			todos: [],
		},
	} as unknown as WorkspaceShellModel;
}

/** Renders the open dialog with the given post-merge policy. */
function renderDialog({
	archiveAfterMerge = false,
	baseBranch,
	updateBaseAfterMerge,
}: {
	archiveAfterMerge?: boolean;
	baseBranch?: string;
	updateBaseAfterMerge: boolean;
}) {
	return renderWithProviders(
		<MergeConfirmationDialog
			archiveAfterMerge={archiveAfterMerge}
			deleteLocalBranchOnArchive={false}
			isSubmitting={false}
			onConfirm={vi.fn()}
			onOpenChange={vi.fn()}
			open
			updateBaseAfterMerge={updateBaseAfterMerge}
			workspace={workspaceWithBase(baseBranch)}
		/>,
	);
}

describe('MergeConfirmationDialog base update line', () => {
	it('names the local base branch when the setting is on', () => {
		renderDialog({ baseBranch: 'origin/master', updateBaseAfterMerge: true });

		expect(
			screen.getByText('Local master will be fast-forwarded'),
		).toBeInTheDocument();
	});

	it('falls back to a generic line when the base branch is unknown', () => {
		renderDialog({ updateBaseAfterMerge: true });

		expect(
			screen.getByText('Local base branch will be fast-forwarded'),
		).toBeInTheDocument();
	});

	it('omits the line when the setting is off', () => {
		renderDialog({ baseBranch: 'master', updateBaseAfterMerge: false });

		expect(screen.queryByText(/fast-forwarded/)).toBeNull();
	});

	it('shows the archive line and the base update line together', () => {
		renderDialog({
			archiveAfterMerge: true,
			baseBranch: 'master',
			updateBaseAfterMerge: true,
		});

		expect(screen.getByText('Workspace will be archived')).toBeInTheDocument();
		expect(
			screen.getByText('Local master will be fast-forwarded'),
		).toBeInTheDocument();
	});
});
