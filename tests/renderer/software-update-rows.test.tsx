// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { SoftwareUpdateRows } from '@/renderer/components/settings/software-update-rows';
import { updateStatusAtom } from '@/renderer/state/updates';
import { DEFAULT_APP_SETTINGS } from '@/shared/config';
import type {
	UpdateFailureCode,
	UpdateStatusSnapshot,
} from '@/shared/ipc/contracts/update';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

/** A snapshot of a current release build, narrowed per test to the state under exam. */
function snapshot(
	overrides: Partial<UpdateStatusSnapshot> = {},
): UpdateStatusSnapshot {
	return {
		availableVersion: null,
		channel: 'release',
		currentVersion: '0.1.0-beta.7',
		failure: null,
		notes: null,
		state: 'idle',
		...overrides,
	};
}

/** Renders the row with the snapshot already seeded, as the app-root sync would. */
function renderRow(value: UpdateStatusSnapshot | null) {
	const store = createStore();
	store.set(updateStatusAtom, value);
	return renderWithProviders(
		<Provider store={store}>
			<SoftwareUpdateRows />
		</Provider>,
	);
}

beforeEach(() => {
	installEnsemblrApi({
		checkForUpdates: vi.fn(async () => snapshot()),
		getAppSettings: vi.fn(async () => DEFAULT_APP_SETTINGS),
		installUpdate: vi.fn(async () => snapshot({ state: 'ready' })),
		updateAppSettings: vi.fn(async () => DEFAULT_APP_SETTINGS),
	});
});

afterEach(() => {
	clearEnsemblrApi();
});

describe('SoftwareUpdateRows', () => {
	test('renders nothing until the first snapshot lands, rather than guessing a version', () => {
		const { container } = renderRow(null);

		expect(container).toBeEmptyDOMElement();
	});

	test('offers the switch that hands the install to a package manager', () => {
		renderRow(snapshot());

		expect(screen.getByRole('switch')).toBeChecked();
	});

	test('a disabled updater says so and cannot be asked to check', () => {
		renderRow(snapshot({ state: 'disabled' }));

		expect(
			screen.getByText('Ensemblr will not check for updates.'),
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Check for updates' }),
		).toBeDisabled();
	});

	test('turning the switch off writes the setting', async () => {
		const user = userEvent.setup();
		renderRow(snapshot());

		await user.click(screen.getByRole('switch'));

		expect(
			(window as unknown as { ensemblr: { updateAppSettings: () => void } })
				.ensemblr.updateAppSettings,
		).toHaveBeenCalled();
	});

	test('shows the running version and offers a check', () => {
		renderRow(snapshot());

		expect(screen.getByText('0.1.0-beta.7')).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Check for updates' }),
		).toBeInTheDocument();
	});

	test('badges a canary build so the channel is never ambiguous', () => {
		renderRow(snapshot({ channel: 'canary' }));

		expect(screen.getByText('Nightly')).toBeInTheDocument();
	});

	test('a release build carries no channel badge', () => {
		renderRow(snapshot());

		expect(screen.queryByText('Nightly')).not.toBeInTheDocument();
	});

	test('offers a restart once a build is staged', () => {
		renderRow(snapshot({ availableVersion: '0.1.0-beta.8', state: 'ready' }));

		expect(
			screen.getByRole('button', { name: 'Restart to update' }),
		).toBeInTheDocument();
		expect(
			screen.getByText('0.1.0-beta.8 is ready — restart to install.'),
		).toBeInTheDocument();
	});

	test('a failure is shown as translated text, never as main’s raw code', () => {
		renderRow(
			snapshot({
				failure: {
					code: 'update-not-in-applications' satisfies UpdateFailureCode,
					message: 'Ensemblr updates itself only from /Applications.',
				},
				state: 'error',
			}),
		);

		expect(
			screen.getByText(
				'Ensemblr updates itself only from the Applications folder. Move it there, then check again.',
			),
		).toBeInTheDocument();
		expect(screen.queryByText(/update-not-in-applications/)).toBeNull();
	});

	test('a build that can never update cannot be asked to try', () => {
		renderRow(
			snapshot({
				failure: {
					code: 'update-unsupported-build',
					message: 'A development build updates by rebuilding it.',
				},
				state: 'unsupported',
			}),
		);

		expect(screen.getByRole('button')).toBeDisabled();
	});

	test('the check button calls through to the updater', async () => {
		const user = userEvent.setup();
		renderRow(snapshot());

		await user.click(screen.getByRole('button', { name: 'Check for updates' }));

		expect(
			(window as unknown as { ensemblr: { checkForUpdates: () => void } })
				.ensemblr.checkForUpdates,
		).toHaveBeenCalledTimes(1);
	});

	test('the restart button calls through to the installer', async () => {
		const user = userEvent.setup();
		renderRow(snapshot({ availableVersion: '0.1.0-beta.8', state: 'ready' }));

		await user.click(screen.getByRole('button', { name: 'Restart to update' }));

		expect(
			(window as unknown as { ensemblr: { installUpdate: () => void } })
				.ensemblr.installUpdate,
		).toHaveBeenCalledTimes(1);
	});
});
