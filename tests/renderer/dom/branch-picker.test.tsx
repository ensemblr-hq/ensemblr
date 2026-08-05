// @vitest-environment happy-dom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import { BranchPicker } from '@/renderer/components/git/branch-picker';
import type { ListRepositoryBranchesResult } from '@/shared/ipc/contracts/workspace-sources';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from '../support/dom';

afterEach(() => {
	clearEnsemblrApi();
});

function branch(name: string, isDefault = false) {
	return { hasWorkspace: false, isDefault, name, workspaceId: null };
}

function installBranches(result: ListRepositoryBranchesResult) {
	const listRepositoryBranches = vi.fn(async () => result);
	installEnsemblrApi({ listRepositoryBranches });
	return listRepositoryBranches;
}

function renderPicker(
	overrides: {
		fallbackOption?: { isActive: boolean; label: string; onSelect: () => void };
		onSelect?: (name: string) => void;
		onSelectCustomRef?: (ref: string) => void;
		value?: string | null;
	} = {},
) {
	return renderWithProviders(
		<BranchPicker
			fallbackOption={overrides.fallbackOption}
			onSelect={overrides.onSelect ?? vi.fn()}
			onSelectCustomRef={overrides.onSelectCustomRef}
			placeholder='Set target branch'
			repositoryId='repo-1'
			searchPlaceholder='Search or enter a branch…'
			value={overrides.value === undefined ? 'origin/master' : overrides.value}
		/>,
	);
}

test('shows the bare branch name on the trigger', () => {
	installBranches({ branches: [], status: 'ok' });
	renderPicker();

	expect(screen.getByRole('button', { name: /master/ })).toBeInTheDocument();
	expect(screen.queryByText('origin/master')).not.toBeInTheDocument();
});

test('does not fetch branches until the popover opens', async () => {
	const listRepositoryBranches = installBranches({
		branches: [branch('master', true)],
		status: 'ok',
	});
	renderPicker();

	expect(listRepositoryBranches).not.toHaveBeenCalled();

	await userEvent.click(screen.getByRole('button', { name: /master/ }));

	await waitFor(() => {
		expect(listRepositoryBranches).toHaveBeenCalledWith({
			repositoryId: 'repo-1',
		});
	});
});

test('reports the bare name of the chosen branch', async () => {
	installBranches({
		branches: [branch('master', true), branch('release/2026')],
		status: 'ok',
	});
	const onSelect = vi.fn();
	renderPicker({ onSelect });

	await userEvent.click(screen.getByRole('button', { name: /master/ }));
	await userEvent.click(await screen.findByText('release/2026'));

	expect(onSelect).toHaveBeenCalledWith('release/2026');
});

test('uses the caller-supplied search placeholder', async () => {
	installBranches({ branches: [branch('master', true)], status: 'ok' });
	renderPicker();

	await userEvent.click(screen.getByRole('button', { name: /master/ }));

	expect(
		await screen.findByPlaceholderText('Search or enter a branch…'),
	).toBeInTheDocument();
});

test('offers a typed ref that names no listed branch', async () => {
	installBranches({ branches: [branch('master', true)], status: 'ok' });
	const onSelect = vi.fn();
	const onSelectCustomRef = vi.fn();
	renderPicker({ onSelect, onSelectCustomRef });

	await userEvent.click(screen.getByRole('button', { name: /master/ }));
	await userEvent.type(
		await screen.findByPlaceholderText('Search or enter a branch…'),
		'upstream/main',
	);
	await userEvent.click(await screen.findByText('upstream/main'));

	expect(onSelectCustomRef).toHaveBeenCalledWith('upstream/main');
	expect(onSelect).not.toHaveBeenCalled();
});

test('reaches a ref even when gh cannot list branches', async () => {
	installBranches({
		branches: [],
		error: {
			code: 'gh-not-installed',
			message: 'gh is not installed.',
			remediation: 'Install the GitHub CLI.',
		},
		status: 'error',
	});
	const onSelectCustomRef = vi.fn();
	renderPicker({ onSelectCustomRef, value: null });

	await userEvent.click(
		screen.getByRole('button', { name: /Set target branch/ }),
	);
	await userEvent.type(
		await screen.findByPlaceholderText('Search or enter a branch…'),
		'v2.1.0',
	);
	await userEvent.click(await screen.findByText('v2.1.0'));

	expect(onSelectCustomRef).toHaveBeenCalledWith('v2.1.0');
});

test('does not offer a typed ref that duplicates a listed branch', async () => {
	installBranches({ branches: [branch('master', true)], status: 'ok' });
	const onSelectCustomRef = vi.fn();
	renderPicker({ onSelectCustomRef });

	await userEvent.click(screen.getByRole('button', { name: /master/ }));
	await userEvent.type(
		await screen.findByPlaceholderText('Search or enter a branch…'),
		'master',
	);

	expect(screen.queryByText('Use')).not.toBeInTheDocument();
});

async function openAndReadFallbackState(
	isActive: boolean,
	value: string | null,
) {
	installBranches({ branches: [branch('master', true)], status: 'ok' });
	renderPicker({
		fallbackOption: {
			isActive,
			label: 'Repository default',
			onSelect: vi.fn(),
		},
		value,
	});

	await userEvent.click(screen.getAllByRole('button')[0] as HTMLElement);

	const fallback = await screen.findByRole('option', {
		name: /Repository default/,
	});
	return fallback.getAttribute('data-checked');
}

test('checks the fallback entry while it is active, even beside a resolved value', async () => {
	expect(await openAndReadFallbackState(true, 'origin/master')).toBe('true');
});

test('leaves the fallback entry unchecked once a value is pinned', async () => {
	expect(await openAndReadFallbackState(false, null)).toBeNull();
});

test('surfaces a gh failure instead of an empty list', async () => {
	installBranches({
		branches: [],
		error: {
			code: 'gh-not-authenticated',
			message: 'gh is not authenticated.',
			remediation: 'Run `gh auth login`.',
		},
		status: 'error',
	});
	renderPicker();

	await userEvent.click(screen.getByRole('button', { name: /master/ }));

	expect(
		await screen.findByText('gh is not authenticated.'),
	).toBeInTheDocument();
	expect(screen.getByText('Run `gh auth login`.')).toBeInTheDocument();
});

test('distinguishes an empty remote from a failure', async () => {
	installBranches({ branches: [], status: 'ok' });
	renderPicker();

	await userEvent.click(screen.getByRole('button', { name: /master/ }));

	expect(
		await screen.findByText('No remote branches found.'),
	).toBeInTheDocument();
});
