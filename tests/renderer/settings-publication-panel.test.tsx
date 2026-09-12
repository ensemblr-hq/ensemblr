// @vitest-environment happy-dom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { SettingsPublicationPanel } from '@/renderer/components/settings/repo-publication/settings-publication-panel';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type {
	SettingsPublicationFailureCode,
	SettingsPublicationPreview,
} from '@/shared/ipc/contracts/settings-publication';
import { renderWithProviders } from './support/dom';

const api = vi.hoisted(() => ({
	apply: vi.fn(),
	cleanup: vi.fn(),
	preview: vi.fn(),
	restore: vi.fn(),
}));

vi.mock('@/renderer/api/ensemblr', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	applySettingsPublication: (...args: unknown[]) => api.apply(...args),
	cleanupSettingsPublication: (...args: unknown[]) => api.cleanup(...args),
	previewSettingsPublication: (...args: unknown[]) => api.preview(...args),
	restoreSettingsPublication: (...args: unknown[]) => api.restore(...args),
	settingsPublicationRecoveryStatusQuery: (repositoryId: string) => ({
		queryFn: async () => ({ failure: null, recoveries: [] }),
		queryKey: ['settings-publication-recovery-status', repositoryId],
	}),
}));

const workspaces = [
	{ id: 'ws-1', name: 'Feature work' },
] as unknown as WorkspaceShellModel[];

vi.mock('@/renderer/hooks/use-settings-workspace-target', () => ({
	useSettingsWorkspaceTarget: () => ({
		selectWorkspace: () => {},
		selectedWorkspaceId: 'ws-1',
		workspaces,
	}),
}));

/** Builds a preview with only the fields the panel reads. */
function previewResult(
	overrides: Partial<SettingsPublicationPreview> = {},
): SettingsPublicationPreview {
	return {
		hasLegacyScripts: false,
		mergedText: '[scripts]\nsetup = "npm ci"\n',
		repositoryId: 'repo-1',
		sourceStatus: 'modified',
		status: 'clean',
		token: 'token-1',
		workspaceId: 'ws-1',
		...overrides,
	};
}

/** Resolves the preview call with a coded failure and no preview. */
function failWith(code: SettingsPublicationFailureCode): void {
	api.preview.mockResolvedValue({
		failure: { code, message: `main said ${code}` },
		preview: null,
	});
}

/** Renders the panel for the single-workspace repository the tests use. */
function renderPanel() {
	return renderWithProviders(<SettingsPublicationPanel repoId='repo-1' />);
}

describe('SettingsPublicationPanel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		api.preview.mockResolvedValue({ failure: null, preview: previewResult() });
		api.apply.mockResolvedValue({
			failure: null,
			recoveryId: 'recovery-1',
			status: 'applied',
		});
		api.cleanup.mockResolvedValue({ failure: null, status: 'cleaned' });
	});

	test('reports an empty root clone rather than an error', async () => {
		failWith('source-missing');
		renderPanel();

		expect(
			await screen.findByText(/holds no unpublished settings/i),
		).toBeInTheDocument();
		expect(screen.queryByText(/main said source-missing/i)).toBeNull();
		expect(
			screen.queryByRole('button', { name: /publish to workspace/i }),
		).toBeNull();
	});

	test('offers a retry when the preview call rejects outright', async () => {
		const user = userEvent.setup();
		api.preview.mockRejectedValueOnce(new Error('bridge is gone'));
		renderPanel();

		expect(
			await screen.findByText(/could not complete the request/i),
		).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: /try again/i }));

		expect(
			await screen.findByRole('button', { name: /publish to workspace/i }),
		).toBeInTheDocument();
	});

	test('publishes a clean preview with the token the backend issued', async () => {
		const user = userEvent.setup();
		renderPanel();

		await user.click(
			await screen.findByRole('button', { name: /publish to workspace/i }),
		);

		await waitFor(() => {
			expect(api.apply).toHaveBeenCalledWith({
				previewToken: 'token-1',
				repositoryId: 'repo-1',
				workspaceId: 'ws-1',
			});
		});
	});

	test('offers no publish action for a conflicting preview', async () => {
		api.preview.mockResolvedValue({
			failure: null,
			preview: previewResult({
				mergedText: '<<<<<<< HEAD\na\n=======\nb\n>>>>>>>\n',
				status: 'conflict',
			}),
		});
		renderPanel();

		expect(
			await screen.findByText(/publishing is unavailable/i),
		).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: /publish to workspace/i }),
		).toBeNull();
	});

	test('tells the user the workspace file was replaced when the write is unverified', async () => {
		const user = userEvent.setup();
		api.apply.mockResolvedValue({
			failure: { code: 'write-failed', message: 'main said write-failed' },
			recoveryId: null,
			status: 'failed',
		});
		renderPanel();

		await user.click(
			await screen.findByRole('button', { name: /publish to workspace/i }),
		);

		expect(
			await screen.findByText(/the write could not be verified/i),
		).toBeInTheDocument();
		expect(screen.queryByText(/nothing was written/i)).not.toBeInTheDocument();
	});

	test('offers a retry hint for a stale preview without claiming a write happened', async () => {
		const user = userEvent.setup();
		api.apply.mockResolvedValue({
			failure: { code: 'preview-stale', message: 'main said preview-stale' },
			recoveryId: null,
			status: 'failed',
		});
		renderPanel();

		await user.click(
			await screen.findByRole('button', { name: /publish to workspace/i }),
		);

		expect(await screen.findByText(/nothing was written/i)).toBeInTheDocument();
		expect(
			screen.queryByText(/the write could not be verified/i),
		).not.toBeInTheDocument();
	});

	test('confirms the root cleanup separately from the publication', async () => {
		const user = userEvent.setup();
		renderPanel();

		await user.click(
			await screen.findByRole('button', { name: /publish to workspace/i }),
		);

		const removeButton = await screen.findByRole('button', {
			name: /remove root copy/i,
		});
		expect(api.cleanup).not.toHaveBeenCalled();

		await user.click(removeButton);
		expect(api.cleanup).not.toHaveBeenCalled();

		await user.click(screen.getByRole('button', { name: /remove it/i }));
		await waitFor(() => {
			expect(api.cleanup).toHaveBeenCalledWith({ recoveryId: 'recovery-1' });
		});
	});
});
