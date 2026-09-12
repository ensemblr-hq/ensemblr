// @vitest-environment happy-dom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { InfisicalLinkPanel } from '@/renderer/components/settings/repo-infisical/infisical-link-panel';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type {
	InfisicalAccountSnapshot,
	InfisicalLinkSnapshot,
	InfisicalProjectSnapshot,
} from '@/shared/ipc/contracts/infisical';
import { installEnsemblrApi, renderWithProviders } from './support/dom';

const api = vi.hoisted(() => ({
	clearInfisicalLink: vi.fn(),
	setInfisicalLink: vi.fn(),
	syncInfisicalLink: vi.fn(),
}));

const account: InfisicalAccountSnapshot = {
	clientId: 'client-1',
	createdAt: '',
	id: 'acct-1',
	label: 'Acct',
	lastErrorCode: null,
	lastVerifiedAt: null,
	maskedClientSecret: null,
	siteUrl: 'https://app.infisical.com',
	updatedAt: '',
};

const project: InfisicalProjectSnapshot = {
	accountId: 'acct-1',
	accountLabel: 'Acct',
	environments: [{ name: 'Development', slug: 'dev' }],
	id: 'proj-1',
	name: 'Proj One',
	slug: 'proj-one',
};

const link: InfisicalLinkSnapshot = {
	accountId: 'acct-1',
	accountLabel: 'Acct',
	enabled: true,
	environmentSlug: 'dev',
	lastSyncedAt: null,
	origin: 'local',
	projectId: 'proj-1',
	projectName: 'Proj One',
	recursive: false,
	scope: 'repository',
	scopeId: 'repo-1',
	secretPath: '/',
	siteUrl: 'https://app.infisical.com',
};

const workspaces = [
	{ id: 'ws-1', name: 'Feature work' },
	{ id: 'ws-2', name: 'Ops' },
] as unknown as WorkspaceShellModel[];

const selectWorkspace = vi.fn();

const workspaceTarget = vi.hoisted(() => ({
	selectedWorkspaceId: 'ws-1' as string | undefined,
	workspaces: [] as WorkspaceShellModel[],
}));

vi.mock('@/renderer/hooks/use-settings-workspace-target', () => ({
	useSettingsWorkspaceTarget: () => ({
		selectWorkspace,
		selectedWorkspaceId: workspaceTarget.selectedWorkspaceId,
		workspaces: workspaceTarget.workspaces,
	}),
}));

/** Installs a stub `window.ensemblr` bridge answering every Infisical call the panel makes. */
function installApi(overrides: { link?: InfisicalLinkSnapshot | null } = {}) {
	installEnsemblrApi({
		infisicalAccounts: vi.fn().mockResolvedValue({
			accounts: [account],
			failure: null,
		}),
		infisicalClearLink: (...args: unknown[]) => api.clearInfisicalLink(...args),
		infisicalLink: vi.fn().mockResolvedValue({
			failure: null,
			link: overrides.link === undefined ? link : overrides.link,
		}),
		infisicalProjects: vi.fn().mockResolvedValue({
			accountFailures: [],
			failure: null,
			projects: [project],
		}),
		infisicalSetLink: (...args: unknown[]) => api.setInfisicalLink(...args),
		infisicalSync: (...args: unknown[]) => api.syncInfisicalLink(...args),
	});
}

/** Renders the panel for the repository these fixtures describe. */
function renderPanel() {
	return renderWithProviders(<InfisicalLinkPanel repoId='repo-1' />);
}

describe('InfisicalLinkPanel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		workspaceTarget.selectedWorkspaceId = 'ws-1';
		workspaceTarget.workspaces = workspaces;
		api.setInfisicalLink.mockResolvedValue({ failure: null, link });
		api.clearInfisicalLink.mockResolvedValue({ failure: null, link: null });
		api.syncInfisicalLink.mockResolvedValue({ failure: null, keys: [] });
	});

	test('reports no live workspace instead of a form', () => {
		workspaceTarget.selectedWorkspaceId = undefined;
		workspaceTarget.workspaces = [];
		installApi();
		renderPanel();

		expect(screen.getByText('No live workspace yet')).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: /save link/i }),
		).not.toBeInTheDocument();
	});

	test('shows the workspace-target picker and switches target', async () => {
		const user = userEvent.setup();
		installApi();
		renderPanel();

		expect(await screen.findByText('Save to workspace')).toBeInTheDocument();

		const [workspaceCombobox] = await screen.findAllByRole('combobox');
		await user.click(workspaceCombobox);
		await user.click(await screen.findByRole('option', { name: 'Ops' }));

		expect(selectWorkspace).toHaveBeenCalledWith('ws-2');
	});

	test('carries the selected workspaceId to main on save', async () => {
		const user = userEvent.setup();
		installApi();
		renderPanel();

		const [recursiveSwitch] = await screen.findAllByRole('switch');
		await user.click(recursiveSwitch);
		await user.click(await screen.findByRole('button', { name: /save link/i }));

		await waitFor(() => {
			expect(api.setInfisicalLink).toHaveBeenCalledWith({
				accountId: 'acct-1',
				environmentSlug: 'dev',
				projectId: 'proj-1',
				projectName: 'Proj One',
				recursive: true,
				scope: 'repository',
				scopeId: 'repo-1',
				secretPath: '/',
				workspaceId: 'ws-1',
			});
		});
	});

	test('drops the synced key list once the link is saved again', async () => {
		const user = userEvent.setup();
		installApi();
		api.syncInfisicalLink.mockResolvedValue({
			failure: null,
			keys: ['DATABASE_URL'],
		});
		renderPanel();

		await user.click(await screen.findByRole('button', { name: /sync now/i }));
		expect(await screen.findByText('DATABASE_URL')).toBeInTheDocument();

		const [recursiveSwitch] = await screen.findAllByRole('switch');
		await user.click(recursiveSwitch);
		await user.click(await screen.findByRole('button', { name: /save link/i }));

		await waitFor(() => {
			expect(screen.queryByText('DATABASE_URL')).not.toBeInTheDocument();
		});
	});

	test('renders the workspace-required failure', async () => {
		const user = userEvent.setup();
		installApi();
		api.setInfisicalLink.mockResolvedValue({
			failure: {
				code: 'infisical-workspace-required',
				message: 'main said infisical-workspace-required',
				retryAfterSeconds: null,
			},
			link: null,
		});
		renderPanel();

		const [recursiveSwitch] = await screen.findAllByRole('switch');
		await user.click(recursiveSwitch);
		await user.click(await screen.findByRole('button', { name: /save link/i }));

		expect(
			await screen.findByText(
				/open a workspace for this repository, then save again/i,
			),
		).toBeInTheDocument();
	});
});
