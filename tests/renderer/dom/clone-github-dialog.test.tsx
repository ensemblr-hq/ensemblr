// register-dom (via --preload) registers the DOM before the component graph loads.

import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ensembleQueryKeys } from '@/renderer/api/ensemble-queries';
import type {
	GithubRepositoryEntry,
	GithubRepositoryListResult,
} from '@/shared/ipc/contracts/clone';
import {
	clearEnsembleApi,
	createTestQueryClient,
	installEnsembleApi,
	renderWithProviders,
} from '../support/dom';

const FIXED_ISO = '2026-01-01T00:00:00.000Z';

/** Mutable clone-flow stand-in; the mocked useCloneFlow returns whatever this holds. */
let flow = makeFlow();

mock.module('@/renderer/hooks/welcome/use-clone-flow', () => ({
	useCloneFlow: () => flow,
}));

const { CloneGithubDialog } = await import(
	'@/renderer/components/welcome/clone-github-dialog.tsx'
);

function makeFlow(
	overrides: Partial<ReturnType<typeof baseFlow>> = {},
): ReturnType<typeof baseFlow> {
	return { ...baseFlow(), ...overrides };
}

function baseFlow() {
	return {
		diagnostics: [] as unknown[],
		isBusy: false,
		logs: [] as unknown[],
		retry: () => {},
		stage: 'idle' as
			| 'idle'
			| 'preparing'
			| 'cloning'
			| 'opening'
			| 'success'
			| 'failure',
		startClone: mock(async () => {}),
		successResult: null,
	};
}

function repo(fullName: string): GithubRepositoryEntry {
	return {
		avatarUrl: null,
		description: null,
		fullName,
		isPrivate: false,
		ownerLogin: fullName.split('/')[0] ?? '',
		updatedAt: FIXED_ISO,
	};
}

function listResult(
	entries: GithubRepositoryEntry[],
	overrides: Partial<GithubRepositoryListResult> = {},
): GithubRepositoryListResult {
	return { entries, generatedAt: FIXED_ISO, status: 'success', ...overrides };
}

/** A QueryClient pre-seeded so the dialog paints synchronously. */
function seededClient(options: { recent?: GithubRepositoryListResult } = {}) {
	const client = createTestQueryClient();
	client.setQueryData(
		ensembleQueryKeys.githubRepositoryList('recent'),
		options.recent ?? listResult([repo('octo/alpha'), repo('octo/beta')]),
	);
	client.setQueryData(
		ensembleQueryKeys.githubRepositoryList('full'),
		listResult([
			repo('octo/alpha'),
			repo('octo/beta'),
			repo('octo/widgets-deep'),
		]),
	);
	client.setQueryData(ensembleQueryKeys.rootDirectory(), {
		repositoriesPath: '/tmp/repos',
	});
	return client;
}

beforeEach(() => {
	flow = makeFlow();
	installEnsembleApi({
		githubRepositoryList: mock(async () => listResult([])),
		rootDirectory: mock(async () => ({ repositoriesPath: '/tmp/repos' })),
		selectCloneDestination: mock(async () => ({
			canceled: false,
			path: '/picked/dir',
		})),
	});
});

afterEach(() => {
	clearEnsembleApi();
});

function renderDialog(client = seededClient()) {
	return renderWithProviders(
		<CloneGithubDialog onOpenChange={() => {}} open={true} />,
		{ client },
	);
}

test('lists the recent repos and labels them', () => {
	renderDialog();
	expect(screen.getByText('Recent repos')).toBeInTheDocument();
	expect(screen.getByText('octo/alpha')).toBeInTheDocument();
	expect(screen.getByText('octo/beta')).toBeInTheDocument();
});

test('typing a search term switches to matching-repos and filters the full set', async () => {
	const user = userEvent.setup();
	renderDialog();
	await user.type(screen.getByLabelText('Repository URL'), 'widgets');

	expect(screen.getByText('Matching repos')).toBeInTheDocument();
	expect(screen.getByText('octo/widgets-deep')).toBeInTheDocument();
	expect(screen.queryByText('octo/alpha')).toBeNull();
});

test('the clone button stays disabled while the input is a search term', async () => {
	const user = userEvent.setup();
	renderDialog();
	await user.type(screen.getByLabelText('Repository URL'), 'widgets');

	expect(screen.getByRole('button', { name: 'Clone repo' })).toBeDisabled();
});

test('arrow + Enter confirms a result into a clonable URL and enables cloning', async () => {
	const user = userEvent.setup();
	renderDialog();
	const input = screen.getByLabelText('Repository URL');
	await user.type(input, 'widgets');
	await user.keyboard('{ArrowDown}{Enter}');

	expect(input).toHaveValue('https://github.com/octo/widgets-deep.git');
	const clone = screen.getByRole('button', { name: 'Clone repo' });
	expect(clone).toBeEnabled();

	await user.click(clone);
	await waitFor(() => expect(flow.startClone).toHaveBeenCalledTimes(1));
	expect(flow.startClone.mock.calls[0]?.[0]).toMatchObject({
		url: 'https://github.com/octo/widgets-deep.git',
	});
});

test('pasting a URL enables cloning without any search', async () => {
	const user = userEvent.setup();
	renderDialog();
	await user.type(
		screen.getByLabelText('Repository URL'),
		'https://github.com/octo/alpha.git',
	);
	const clone = screen.getByRole('button', { name: 'Clone repo' });
	expect(clone).toBeEnabled();
	await user.click(clone);
	await waitFor(() => expect(flow.startClone).toHaveBeenCalledTimes(1));
});

test('browsing sets a location override and can be reset', async () => {
	const user = userEvent.setup();
	renderDialog();
	await user.click(screen.getByRole('button', { name: 'Browse' }));

	const location = screen.getByLabelText('Location');
	await waitFor(() => expect(location).toHaveValue('/picked/dir'));

	await user.click(
		screen.getByRole('button', { name: /reset to managed repos directory/i }),
	);
	await waitFor(() => expect(location).toHaveValue('/tmp/repos'));
});

test('surfaces a recent-list failure message', () => {
	renderDialog(
		seededClient({
			recent: listResult([], { error: 'gh api failed.', status: 'failure' }),
		}),
	);
	expect(screen.getByText('gh api failed.')).toBeInTheDocument();
});

for (const { stage, label } of [
	{ label: 'Preparing…', stage: 'preparing' as const },
	{ label: 'Cloning…', stage: 'cloning' as const },
	{ label: 'Opening…', stage: 'opening' as const },
]) {
	test(`renders the ${stage} button label`, () => {
		flow = makeFlow({ isBusy: true, stage });
		renderDialog();
		expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
	});
}
