// @vitest-environment happy-dom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { InfisicalAccountsRow } from '@/renderer/components/settings/integrations/infisical-accounts-row';
import type { InfisicalAccountSnapshot } from '@/shared/ipc/contracts/infisical';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

/** Builds an account snapshot with sensible defaults for the field under test. */
function account(
	overrides: Partial<InfisicalAccountSnapshot> = {},
): InfisicalAccountSnapshot {
	return {
		clientId: 'client-abc',
		createdAt: '2026-08-01T00:00:00.000Z',
		id: 'acc-1',
		label: 'Work org',
		lastErrorCode: null,
		lastVerifiedAt: '2026-08-01T00:00:00.000Z',
		maskedClientSecret: '****cdef',
		siteUrl: 'https://app.infisical.com',
		updatedAt: '2026-08-01T00:00:00.000Z',
		...overrides,
	};
}

afterEach(() => {
	clearEnsemblrApi();
});

describe('InfisicalAccountsRow', () => {
	test('lists a configured account with its instance and masked secret', async () => {
		installEnsemblrApi({
			infisicalAccounts: vi.fn(async () => ({
				accounts: [account()],
				failure: null,
			})),
		});

		renderWithProviders(<InfisicalAccountsRow />);

		expect(await screen.findByText('Work org')).toBeInTheDocument();
		expect(
			screen.getByText(/app\.infisical\.com.*client-abc.*\*\*\*\*cdef/),
		).toBeInTheDocument();
	});

	test('shows an empty state when no account is configured', async () => {
		installEnsemblrApi({
			infisicalAccounts: vi.fn(async () => ({ accounts: [], failure: null })),
		});

		renderWithProviders(<InfisicalAccountsRow />);

		expect(
			await screen.findByText(/No Infisical accounts yet/),
		).toBeInTheDocument();
	});

	test('badges an account whose last check failed as not working', async () => {
		installEnsemblrApi({
			infisicalAccounts: vi.fn(async () => ({
				accounts: [
					account({
						lastErrorCode: 'infisical-invalid-credentials',
						lastVerifiedAt: null,
					}),
				],
				failure: null,
			})),
		});

		renderWithProviders(<InfisicalAccountsRow />);

		expect(await screen.findByText('Not working')).toBeInTheDocument();
	});

	test('badges a never-checked account distinctly from a working one', async () => {
		installEnsemblrApi({
			infisicalAccounts: vi.fn(async () => ({
				accounts: [account({ lastErrorCode: null, lastVerifiedAt: null })],
				failure: null,
			})),
		});

		renderWithProviders(<InfisicalAccountsRow />);

		expect(await screen.findByText('Not checked')).toBeInTheDocument();
	});

	test('surfaces the translated failure when a re-check is rejected', async () => {
		installEnsemblrApi({
			infisicalAccounts: vi.fn(async () => ({
				accounts: [account()],
				failure: null,
			})),
			infisicalTestAccount: vi.fn(async () => ({
				account: null,
				failure: {
					code: 'infisical-invalid-credentials',
					message: 'Signing in to Infisical failed (401): Invalid credentials',
					retryAfterSeconds: null,
				},
			})),
		});

		renderWithProviders(<InfisicalAccountsRow />);
		await userEvent.click(
			await screen.findByRole('button', { name: 'Re-check' }),
		);

		await waitFor(() => {
			expect(
				screen.getByText(/Infisical rejected these credentials/),
			).toBeInTheDocument();
		});
	});

	test('confirms a successful re-check in the live region, not in row layout', async () => {
		installEnsemblrApi({
			infisicalAccounts: vi.fn(async () => ({
				accounts: [account()],
				failure: null,
			})),
			infisicalTestAccount: vi.fn(async () => ({
				account: account(),
				failure: null,
			})),
		});

		renderWithProviders(<InfisicalAccountsRow />);
		await userEvent.click(
			await screen.findByRole('button', { name: 'Re-check' }),
		);

		await waitFor(() => {
			expect(screen.getByRole('status')).toHaveTextContent('Credentials work.');
		});
		expect(screen.getByRole('status')).toHaveClass('sr-only');
	});
});
