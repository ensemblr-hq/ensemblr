import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { CloneGithubRecentRepos } from '../../src/renderer/components/welcome/clone-github-recent-repos';
import type { GithubRepositoryEntry } from '../../src/shared/ipc/contracts/clone';

function repo(
	overrides: Partial<GithubRepositoryEntry> = {},
): GithubRepositoryEntry {
	return {
		avatarUrl: null,
		description: null,
		fullName: 'octo/hello-world',
		isPrivate: false,
		ownerLogin: 'octo',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

test('renders a listbox with an option row per repo', () => {
	const markup = renderToStaticMarkup(
		<CloneGithubRecentRepos
			disabled={false}
			emptyMessage='No repos to suggest yet.'
			highlightedIndex={-1}
			isLoading={false}
			listboxId='clone-github-repo-results'
			onSelect={() => {}}
			repos={[
				repo({ fullName: 'octo/hello-world' }),
				repo({ fullName: 'octo/second-repo' }),
			]}
		/>,
	);

	expect(markup).toContain('role="listbox"');
	expect(markup).toContain('id="clone-github-repo-results"');
	expect(markup).toContain('role="option"');
	expect(markup).toContain('octo/hello-world');
	expect(markup).toContain('octo/second-repo');
});

test('marks only the highlighted row aria-selected, with a matching id', () => {
	const markup = renderToStaticMarkup(
		<CloneGithubRecentRepos
			disabled={false}
			emptyMessage='No repos to suggest yet.'
			highlightedIndex={1}
			isLoading={false}
			listboxId='clone-github-repo-results'
			onSelect={() => {}}
			repos={[
				repo({ fullName: 'octo/first' }),
				repo({ fullName: 'octo/second' }),
			]}
		/>,
	);

	expect(markup).toContain('id="clone-github-repo-results-1"');
	expect(markup).toContain('aria-selected="true"');
	expect(markup).toContain('aria-selected="false"');
});

test('shows the private badge and description when present', () => {
	const markup = renderToStaticMarkup(
		<CloneGithubRecentRepos
			disabled={false}
			emptyMessage='No repos to suggest yet.'
			highlightedIndex={-1}
			isLoading={false}
			listboxId='clone-github-repo-results'
			onSelect={() => {}}
			repos={[
				repo({
					description: 'A private repo',
					fullName: 'octo/secret',
					isPrivate: true,
				}),
			]}
		/>,
	);

	expect(markup).toContain('Private');
	expect(markup).toContain('A private repo');
});

test('shows the empty message when there are no repos and it is not loading', () => {
	const markup = renderToStaticMarkup(
		<CloneGithubRecentRepos
			disabled={false}
			emptyMessage='No matching repositories.'
			highlightedIndex={-1}
			isLoading={false}
			listboxId='clone-github-repo-results'
			onSelect={() => {}}
			repos={[]}
		/>,
	);

	expect(markup).toContain('No matching repositories.');
	expect(markup).not.toContain('role="listbox"');
});

test('shows a loading indicator instead of the empty message while loading with no repos yet', () => {
	const markup = renderToStaticMarkup(
		<CloneGithubRecentRepos
			disabled={false}
			emptyMessage='No repos to suggest yet.'
			highlightedIndex={-1}
			isLoading={true}
			listboxId='clone-github-repo-results'
			onSelect={() => {}}
			repos={[]}
		/>,
	);

	expect(markup).toContain('Loading repos from GitHub');
	expect(markup).not.toContain('No repos to suggest yet.');
});

test('renders the footer hint when provided', () => {
	const markup = renderToStaticMarkup(
		<CloneGithubRecentRepos
			disabled={false}
			emptyMessage='No matching repositories.'
			footerHint='Searching all repositories…'
			highlightedIndex={-1}
			isLoading={false}
			listboxId='clone-github-repo-results'
			onSelect={() => {}}
			repos={[repo()]}
		/>,
	);

	expect(markup).toContain('Searching all repositories…');
});

test('keeps the footer hint visible alongside the empty message', () => {
	const markup = renderToStaticMarkup(
		<CloneGithubRecentRepos
			disabled={false}
			emptyMessage='No matching repositories.'
			footerHint='Searching all repositories…'
			highlightedIndex={-1}
			isLoading={false}
			listboxId='clone-github-repo-results'
			onSelect={() => {}}
			repos={[]}
		/>,
	);

	expect(markup).toContain('No matching repositories.');
	expect(markup).toContain('Searching all repositories…');
});

test('omits the footer hint element when not provided', () => {
	const markup = renderToStaticMarkup(
		<CloneGithubRecentRepos
			disabled={false}
			emptyMessage='No matching repositories.'
			highlightedIndex={-1}
			isLoading={false}
			listboxId='clone-github-repo-results'
			onSelect={() => {}}
			repos={[repo()]}
		/>,
	);

	expect(markup).not.toContain('Searching all repositories…');
});
