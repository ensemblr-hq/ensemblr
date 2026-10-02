// @vitest-environment happy-dom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { LinearConnectionRow } from '@/renderer/components/settings/integrations/linear-connection-row';
import type {
	LinearAccountSnapshot,
	LinearConnectionSummary,
} from '@/shared/ipc/contracts/linear';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

// The row links to the browse route, and TanStack's Link needs a mounted router
// the settings tree does not have here. The destination is route configuration,
// not behaviour of this row, so the link renders as a plain anchor.
vi.mock('@tanstack/react-router', () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));

/** Builds an account snapshot with sensible defaults for the field under test. */
function account(
	overrides: Partial<LinearAccountSnapshot> = {},
): LinearAccountSnapshot {
	return {
		expiresAt: null,
		id: 'acct-1',
		lastErrorCode: null,
		organizationId: 'org-1',
		organizationName: 'Acme',
		organizationUrlKey: 'acme',
		scopes: ['read', 'write'],
		state: 'connected',
		updatedAt: '2026-08-01T00:00:00.000Z',
		userEmail: 'ada@acme.test',
		userId: 'viewer-1',
		userName: 'Ada',
		...overrides,
	};
}

/** Builds the summary the settings row reads, defaulting to one live account. */
function summary(
	overrides: Partial<LinearConnectionSummary> = {},
): LinearConnectionSummary {
	return { accounts: [account()], state: 'connected', ...overrides };
}

afterEach(() => {
	clearEnsemblrApi();
});

describe('LinearConnectionRow', () => {
	test('lists every connected account by organization and identity', async () => {
		installEnsemblrApi({
			linearConnectionStatus: vi.fn(async () =>
				summary({
					accounts: [
						account(),
						account({
							id: 'acct-2',
							organizationId: 'org-2',
							organizationName: 'Client Co',
							organizationUrlKey: 'client-co',
							userEmail: 'ada@client.test',
							userId: 'viewer-2',
							userName: 'Ada (client)',
						}),
					],
				}),
			),
		});

		renderWithProviders(<LinearConnectionRow />);

		expect(await screen.findByText('Acme')).toBeInTheDocument();
		expect(screen.getByText('Client Co')).toBeInTheDocument();
		expect(screen.getByText(/Ada · acme/)).toBeInTheDocument();
		expect(screen.getByText(/2 accounts connected/)).toBeInTheDocument();
	});

	test('invites a first connection when no account is connected', async () => {
		installEnsemblrApi({
			linearConnectionStatus: vi.fn(async () =>
				summary({ accounts: [], state: 'disconnected' }),
			),
		});

		renderWithProviders(<LinearConnectionRow />);

		expect(
			await screen.findByText(/Connect Linear to browse issues/),
		).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Browse issues' }),
		).not.toBeInTheDocument();
	});

	// An account whose token expired past refresh is the one state the user has
	// to act on, and with several connected it has to be legible per row rather
	// than folded into the integration's overall state.
	test('badges the one expired account without disturbing the others', async () => {
		installEnsemblrApi({
			linearConnectionStatus: vi.fn(async () =>
				summary({
					accounts: [
						account(),
						account({
							id: 'acct-2',
							organizationId: 'org-2',
							organizationName: 'Client Co',
							state: 'reconnect-required',
							userId: 'viewer-2',
						}),
					],
				}),
			),
		});

		renderWithProviders(<LinearConnectionRow />);

		expect(await screen.findByText('Client Co')).toBeInTheDocument();
		expect(screen.getByText('Reconnect required')).toBeInTheDocument();
		expect(screen.getAllByText('Connected').length).toBeGreaterThan(0);
	});

	test('disconnects one account by id, behind a confirmation', async () => {
		const linearDisconnect = vi.fn(async () => ({
			status: 'disconnected' as const,
			summary: summary({ accounts: [], state: 'disconnected' }),
		}));
		installEnsemblrApi({
			linearConnectionStatus: vi.fn(async () => summary()),
			linearDisconnect,
		});

		renderWithProviders(<LinearConnectionRow />);

		const disconnect = await screen.findByRole('button', {
			name: 'Disconnect',
		});
		await userEvent.click(disconnect);
		await userEvent.click(
			await screen.findByRole('button', { name: 'Confirm disconnect' }),
		);

		await waitFor(() =>
			expect(linearDisconnect).toHaveBeenCalledWith({ accountId: 'acct-1' }),
		);
	});

	// Main's own message is the support-bundle English and never translated, so
	// the row has to show the headline the code maps to instead.
	test('surfaces a failed login without clearing the accounts already listed', async () => {
		installEnsemblrApi({
			linearConnectionStatus: vi.fn(async () => summary()),
			linearStartLogin: vi.fn(async () => ({
				failure: {
					code: 'callback-timeout' as const,
					message: 'The browser never came back.',
				},
				status: 'error' as const,
			})),
		});

		renderWithProviders(<LinearConnectionRow />);

		await userEvent.click(
			await screen.findByRole('button', { name: /Add account/ }),
		);

		expect(
			await screen.findByText(/Linear did not answer in time/),
		).toBeInTheDocument();
		expect(screen.queryByText('The browser never came back.')).toBeNull();
		expect(screen.getByText('Acme')).toBeInTheDocument();
	});

	// Pressing Cancel is the user's own decision, so reporting it back as a red
	// failure line reads as something having gone wrong.
	test('says nothing when the user cancels the login themselves', async () => {
		installEnsemblrApi({
			linearConnectionStatus: vi.fn(async () => summary()),
			linearStartLogin: vi.fn(async () => ({
				failure: {
					code: 'login-canceled' as const,
					message: 'The Linear login attempt was canceled.',
				},
				status: 'error' as const,
			})),
		});

		renderWithProviders(<LinearConnectionRow />);

		await userEvent.click(
			await screen.findByRole('button', { name: /Add account/ }),
		);

		await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument());
		expect(screen.queryByText(/canceled/i)).toBeNull();
	});

	// The heading badge restated what every account row already says, and read as
	// "connected" while one of those accounts needed reconnecting.
	test('badges connection state per account, not on the integration heading', async () => {
		installEnsemblrApi({
			linearConnectionStatus: vi.fn(async () => summary()),
		});

		renderWithProviders(<LinearConnectionRow />);

		expect(await screen.findByText('Acme')).toBeInTheDocument();
		expect(screen.getAllByText('Connected')).toHaveLength(1);
	});

	test('points at the config file when Linear OAuth is not configured', async () => {
		installEnsemblrApi({
			linearConnectionStatus: vi.fn(async () =>
				summary({ accounts: [], state: 'not-configured' }),
			),
		});

		renderWithProviders(<LinearConnectionRow />);

		expect(
			await screen.findByText(/Add app\.linear\.clientId/),
		).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Add account/ })).toBeDisabled();
	});
});
