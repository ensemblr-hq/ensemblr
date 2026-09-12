// @vitest-environment happy-dom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { PublicationRecoveryList } from '@/renderer/components/settings/repo-publication/publication-recovery-list';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { SettingsPublicationRecoverySnapshot } from '@/shared/ipc/contracts/settings-publication';
import { renderWithProviders } from './support/dom';

const api = vi.hoisted(() => ({
	recoveryStatus: vi.fn(),
	restore: vi.fn(),
}));

vi.mock('@/renderer/api/ensemblr', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	restoreSettingsPublication: (...args: unknown[]) => api.restore(...args),
	settingsPublicationRecoveryStatusQuery: (repositoryId: string) => ({
		queryFn: () => api.recoveryStatus(repositoryId),
		queryKey: ['settings-publication-recovery-status', repositoryId],
	}),
}));

const workspaces = [
	{ id: 'ws-1', name: 'Feature work' },
] as unknown as WorkspaceShellModel[];

/** Builds a recovery record with only the fields the list reads. */
function recoveryRecord(
	overrides: Partial<SettingsPublicationRecoverySnapshot> = {},
): SettingsPublicationRecoverySnapshot {
	return {
		appliedAt: '2026-01-01T12:00:00.000Z',
		cleanedAt: null,
		id: 'recovery-1',
		workspaceId: 'ws-1',
		...overrides,
	} as SettingsPublicationRecoverySnapshot;
}

function renderList(repositoryWorkspaces = workspaces) {
	return renderWithProviders(
		<PublicationRecoveryList
			repositoryId='repo-1'
			workspaces={repositoryWorkspaces}
		/>,
	);
}

describe('PublicationRecoveryList', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		api.restore.mockResolvedValue({ status: 'restored' });
	});

	test('shows a loading state while recoveries are read', () => {
		api.recoveryStatus.mockReturnValue(new Promise(() => {}));
		renderList();

		expect(screen.getByText(/reading recovery snapshots/i)).toBeInTheDocument();
	});

	test('shows the list failure when the read fails', async () => {
		api.recoveryStatus.mockResolvedValue({
			failure: { code: 'unexpected', message: 'main said unexpected' },
			recoveries: [],
		});
		renderList();

		expect(
			await screen.findByText(/main said unexpected/i),
		).toBeInTheDocument();
	});

	test('renders nothing when there are no recoveries', async () => {
		api.recoveryStatus.mockResolvedValue({ failure: null, recoveries: [] });
		const { container } = renderList();

		await waitFor(() => {
			expect(container).toBeEmptyDOMElement();
		});
	});

	test('renders "Published {{when}}" once applied, else "Not published"', async () => {
		api.recoveryStatus.mockResolvedValue({
			failure: null,
			recoveries: [
				recoveryRecord({ appliedAt: '2026-01-01T12:00:00.000Z' }),
				recoveryRecord({ appliedAt: null, id: 'recovery-2' }),
			],
		});
		renderList();

		expect(await screen.findByText(/published .+/i)).toBeInTheDocument();
		expect(screen.getByText(/not published/i)).toBeInTheDocument();
	});

	test('renders "Root copy removed {{when}}" once cleaned, else "Root copy still present"', async () => {
		api.recoveryStatus.mockResolvedValue({
			failure: null,
			recoveries: [
				recoveryRecord({ cleanedAt: '2026-01-02T09:00:00.000Z' }),
				recoveryRecord({ cleanedAt: null, id: 'recovery-2' }),
			],
		});
		renderList();

		expect(
			await screen.findByText(/root copy removed .+/i),
		).toBeInTheDocument();
		expect(screen.getByText(/root copy still present/i)).toBeInTheDocument();
	});

	test('disables "Restore workspace file" until the record has been applied', async () => {
		api.recoveryStatus.mockResolvedValue({
			failure: null,
			recoveries: [recoveryRecord({ appliedAt: null })],
		});
		renderList();

		expect(
			await screen.findByRole('button', { name: /restore workspace file/i }),
		).toBeDisabled();
	});

	test('disables "Restore root file" until the record has been cleaned', async () => {
		api.recoveryStatus.mockResolvedValue({
			failure: null,
			recoveries: [recoveryRecord({ cleanedAt: null })],
		});
		renderList();

		expect(
			await screen.findByRole('button', { name: /restore root file/i }),
		).toBeDisabled();
	});

	test('restores the destination copy with the record id when confirmed', async () => {
		const user = userEvent.setup();
		api.recoveryStatus.mockResolvedValue({
			failure: null,
			recoveries: [
				recoveryRecord({
					appliedAt: '2026-01-01T12:00:00.000Z',
					cleanedAt: '2026-01-02T09:00:00.000Z',
				}),
			],
		});
		renderList();

		await user.click(
			await screen.findByRole('button', { name: /restore workspace file/i }),
		);
		await user.click(
			await screen.findByRole('button', { name: /restore it/i }),
		);

		await waitFor(() => {
			expect(api.restore).toHaveBeenCalledWith({
				copy: 'destination',
				recoveryId: 'recovery-1',
			});
		});
	});

	test('falls back to "Archived workspace" when the workspace is no longer live', async () => {
		api.recoveryStatus.mockResolvedValue({
			failure: null,
			recoveries: [recoveryRecord({ workspaceId: 'ws-gone' })],
		});
		renderList();

		expect(await screen.findByText(/archived workspace/i)).toBeInTheDocument();
	});
});
