// @vitest-environment happy-dom

import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { rootDirectoryQuery } from '@/renderer/api/ensemblr';
import { Route } from '@/renderer/routing/routes/_workbench/settings/repo/$repoId/misc';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type { RootDirectorySnapshot } from '@/shared/ipc/contracts/root-directory';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from '../support/dom';

const { project } = vi.hoisted(() => ({
	project: {
		id: 'repo-pi',
		name: 'Pi configuration',
		owner: { name: 'local' },
		pathLabel: '/Users/example/.pi',
		workspaces: [],
	} satisfies ProjectShellModel,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tanstack/react-router')>()),
	useNavigate: () => vi.fn(),
}));
vi.mock('@/renderer/hooks/use-repo-settings', () => ({
	useRepoSettings: () => ({ project, resolved: () => undefined }),
}));
vi.mock('@/renderer/hooks/use-repo-settings-writer', () => ({
	useRepoSettingsWriter: () => vi.fn(),
}));
vi.mock(
	'@/renderer/components/workbench-shell/delete-repository-dialog',
	() => ({
		DeleteRepositoryDialog: () => null,
	}),
);

function rootSnapshot(workspacesPath: string): RootDirectorySnapshot {
	return {
		archivedContextsPath: '',
		conciergePath: '',
		createdPaths: [],
		diagnostics: [],
		managedPaths: [],
		path: '/Users/example/Ensemblr',
		repositoriesPath: '/Users/example/Ensemblr/repos',
		setting: null,
		source: null,
		status: 'ok',
		workspacesPath,
	};
}

function renderSettings(workspacesPath = '/Users/example/Ensemblr/workspaces') {
	installEnsemblrApi({
		rootDirectory: vi.fn(async () => rootSnapshot(workspacesPath)),
		repositoryWorkspaceNavigation: vi.fn(async () => ({
			generatedAt: '2026-01-01T00:00:00.000Z',
			repositories: [
				{
					createdAt: '2026-01-01T00:00:00.000Z',
					defaultBranch: 'main',
					id: project.id,
					metadata: {},
					name: project.name,
					path: project.pathLabel,
					slug: 'pi-2',
					updatedAt: '2026-01-01T00:00:00.000Z',
					workspaces: [],
				},
			],
		})),
	});
	vi.spyOn(Route, 'useParams').mockReturnValue({ repoId: project.id });
	const Component = Route.options.component;
	if (!Component) throw new Error('Missing repository Misc component');
	return renderWithProviders(<Component />);
}

afterEach(() => {
	clearEnsemblrApi();
	vi.restoreAllMocks();
});

describe('repository Misc paths', () => {
	test('keeps the imported checkout separate from its managed workspace directory', async () => {
		renderSettings();

		expect(screen.getByText('/Users/example/.pi')).toBeInTheDocument();
		expect(screen.getByText('—')).toBeInTheDocument();
		expect(
			await screen.findByText('/Users/example/Ensemblr/workspaces/pi-2'),
		).toBeInTheDocument();
		expect(
			screen.queryByText('/Users/example/.pi (workspaces)'),
		).not.toBeInTheDocument();
	});

	test('uses the configured root and updates when the root snapshot changes', async () => {
		const { client } = renderSettings(
			'/Volumes/Development/Ensemblr/workspaces',
		);

		expect(
			await screen.findByText('/Volumes/Development/Ensemblr/workspaces/pi-2'),
		).toBeInTheDocument();
		act(() => {
			client.setQueryData(
				rootDirectoryQuery.queryKey,
				rootSnapshot('/srv/Ensemblr/workspaces'),
			);
		});
		expect(
			await screen.findByText('/srv/Ensemblr/workspaces/pi-2'),
		).toBeInTheDocument();
		expect(
			screen.queryByText('/Volumes/Development/Ensemblr/workspaces/pi-2'),
		).not.toBeInTheDocument();
	});

	test('does not invent a workspace path when the managed root is unavailable', async () => {
		const { client } = renderSettings();
		await screen.findByText('/Users/example/Ensemblr/workspaces/pi-2');

		act(() => {
			client.setQueryData(rootDirectoryQuery.queryKey, rootSnapshot(''));
		});
		expect(await screen.findByText('—')).toBeInTheDocument();
		expect(screen.queryByText('/pi-2')).not.toBeInTheDocument();
		expect(screen.getByText('/Users/example/.pi')).toBeInTheDocument();
	});
});
