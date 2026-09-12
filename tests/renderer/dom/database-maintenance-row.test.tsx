// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseMaintenanceRow } from '@/renderer/components/settings/database-maintenance-row';

import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
	renderWithProviders,
} from '../support/dom';

function renderRow() {
	const client = createTestQueryClient();
	return renderWithProviders(
		<QueryClientProvider client={client}>
			<DatabaseMaintenanceRow />
		</QueryClientProvider>,
		{ client },
	);
}

describe('DatabaseMaintenanceRow', () => {
	afterEach(() => {
		clearEnsemblrApi();
	});

	it('shows the current size and reports what compaction reclaimed', async () => {
		const user = userEvent.setup();
		installEnsemblrApi({
			compactDatabase: () =>
				Promise.resolve({
					durationMs: 42,
					sizeBytesAfter: 1_000_000,
					sizeBytesBefore: 3_000_000,
				}),
			health: () =>
				Promise.resolve({
					database: { sizeBytes: 3_000_000, status: 'ok' },
					status: 'ok',
				}),
		});

		renderRow();

		await waitFor(() => {
			expect(screen.getByText(/3 MB on disk/i)).toBeInTheDocument();
		});

		const button = screen.getByRole('button', { name: /compact database/i });
		await user.click(button);
		expect(
			screen.getByRole('button', { name: /click again to confirm/i }),
		).toBeInTheDocument();

		await user.click(
			screen.getByRole('button', { name: /click again to confirm/i }),
		);

		await waitFor(() => {
			expect(screen.getByText(/reclaimed 2 mb/i)).toBeInTheDocument();
		});
	});

	it('disarms without compacting when the button loses focus', async () => {
		const user = userEvent.setup();
		let compactCalls = 0;
		installEnsemblrApi({
			compactDatabase: () => {
				compactCalls += 1;
				return Promise.resolve({
					durationMs: 1,
					sizeBytesAfter: 1,
					sizeBytesBefore: 1,
				});
			},
			health: () =>
				Promise.resolve({
					database: { sizeBytes: 1_000, status: 'ok' },
					status: 'ok',
				}),
		});

		renderRow();

		const button = await screen.findByRole('button', {
			name: /compact database/i,
		});
		await user.click(button);
		expect(
			screen.getByRole('button', { name: /click again to confirm/i }),
		).toBeInTheDocument();

		button.blur();

		await waitFor(() => {
			expect(
				screen.getByRole('button', { name: /compact database/i }),
			).toBeInTheDocument();
		});
		expect(compactCalls).toBe(0);
	});
});
