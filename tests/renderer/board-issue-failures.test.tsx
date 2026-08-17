// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { BacklogIssuesError } from '@/renderer/components/workbench-shell/dashboard/backlog-issues-error';
import { groupBoardIssueFailures } from '@/renderer/lib/workbench/board-issue-failures';
import type { BoardIssuesFailure } from '@/renderer/types/workbench-shell';
import type {
	GithubFailure,
	GithubFailureCode,
} from '@/shared/ipc/contracts/github';

import { renderWithProviders } from './support/dom';

/** A repository failure, defaulting to the unclassified catch-all bucket. */
function failure(
	projectName: string,
	overrides: Partial<GithubFailure> & { code?: GithubFailureCode } = {},
): BoardIssuesFailure {
	return {
		failure: {
			code: 'command-failed',
			message: 'gh list command failed.',
			...overrides,
		},
		projectName,
	};
}

describe('groupBoardIssueFailures', () => {
	test('folds repositories that failed the same way into one row', () => {
		const grouped = groupBoardIssueFailures([
			failure('ensemblr', { code: 'gh-not-authenticated', output: 'HTTP 401' }),
			failure('kast-apps', {
				code: 'gh-not-authenticated',
				output: 'HTTP 401',
			}),
		]);

		expect(grouped).toHaveLength(1);
		expect(grouped[0]?.projectNames).toEqual(['ensemblr', 'kast-apps']);
	});

	// The catch-all `command-failed` code says nothing on its own, so two repos
	// failing for different reasons must not collapse into one line.
	test('keeps the same code apart when the command said different things', () => {
		const grouped = groupBoardIssueFailures([
			failure('ensemblr', { output: 'HTTP 404' }),
			failure('kast-apps', { output: 'HTTP 500' }),
		]);

		expect(grouped).toHaveLength(2);
		expect(grouped.map((group) => group.projectNames)).toEqual([
			['ensemblr'],
			['kast-apps'],
		]);
	});

	test('returns nothing when no repository failed', () => {
		expect(groupBoardIssueFailures([])).toEqual([]);
	});
});

describe('BacklogIssuesError', () => {
	test('names the repositories and shows the command output', () => {
		renderWithProviders(
			<BacklogIssuesError
				failures={[
					failure('ensemblr', { output: 'gh: Not Found (HTTP 404)' }),
					failure('kast-apps', { output: 'gh: Not Found (HTTP 404)' }),
				]}
			/>,
		);

		expect(screen.getByRole('alert')).toBeInTheDocument();
		expect(
			screen.getByText(/ensemblr, kast-apps/, { exact: false }),
		).toBeInTheDocument();
		expect(screen.getByText('gh: Not Found (HTTP 404)')).toBeInTheDocument();
	});

	// One banner per distinct failure, so a repository that failed differently is
	// never folded under another repository's explanation.
	test('raises one banner per distinct failure', () => {
		renderWithProviders(
			<BacklogIssuesError
				failures={[
					failure('ensemblr', { output: 'gh: Not Found (HTTP 404)' }),
					failure('kast-apps', { output: 'gh: server error (HTTP 500)' }),
				]}
			/>,
		);

		expect(screen.getAllByRole('alert')).toHaveLength(2);
	});

	// `message` falls back to prose main wrote whenever the command printed
	// nothing, and that prose is never translated — demoting it would dress an
	// English sentence up as gh's own words.
	test('demotes nothing when the command wrote no stderr', () => {
		renderWithProviders(
			<BacklogIssuesError failures={[failure('ensemblr')]} />,
		);

		expect(screen.queryByText('gh list command failed.')).toBeNull();
	});

	test('renders nothing when every repository listed cleanly', () => {
		const { container } = renderWithProviders(
			<BacklogIssuesError failures={[]} />,
		);

		expect(container).toBeEmptyDOMElement();
	});
});
