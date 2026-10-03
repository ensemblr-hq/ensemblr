// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { DEFAULT_APP_SETTINGS } from '../../src/shared/config';
import { renderWithProviders } from './support/dom';

const updateAppSettings = vi.fn((_patch: unknown) => Promise.resolve());

vi.mock('@/renderer/api/ensemblr', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('@/renderer/api/ensemblr')>();
	return {
		...actual,
		getAppSettings: () => Promise.resolve(DEFAULT_APP_SETTINGS),
		updateAppSettings: (patch: unknown) => updateAppSettings(patch),
	};
});

const { ComputeQueueRows } = await import(
	'../../src/renderer/components/settings/compute-queue-rows'
);
const { appSettingsAtom } = await import(
	'../../src/renderer/state/preferences'
);

/** Renders the rows against a store seeded with the given queue settings. */
function renderRows(
	computeQueue: Partial<typeof DEFAULT_APP_SETTINGS.computeQueue>,
) {
	const store = createStore();
	store.set(appSettingsAtom, {
		...DEFAULT_APP_SETTINGS,
		computeQueue: { ...DEFAULT_APP_SETTINGS.computeQueue, ...computeQueue },
	});
	renderWithProviders(
		<Provider store={store}>
			<ComputeQueueRows />
		</Provider>,
	);
	return store;
}

beforeEach(() => {
	updateAppSettings.mockClear();
});

describe('ComputeQueueRows numeric fields', () => {
	test('typing does not write; blur commits the clamped value once', () => {
		renderRows({ concurrency: 2 });
		const input = screen.getByLabelText('Compute queue slots');

		fireEvent.change(input, { target: { value: '' } });
		expect((input as HTMLInputElement).value).toBe('');
		fireEvent.change(input, { target: { value: '99' } });
		expect(updateAppSettings).not.toHaveBeenCalled();

		fireEvent.blur(input);

		expect(updateAppSettings).toHaveBeenCalledTimes(1);
		expect(updateAppSettings).toHaveBeenCalledWith({
			computeQueue: { concurrency: 16 },
		});
	});

	test('Enter commits the draft', () => {
		renderRows({ niceness: 10 });
		const input = screen.getByLabelText('Compute queue CPU priority');

		fireEvent.change(input, { target: { value: '5' } });
		fireEvent.keyDown(input, { key: 'Enter' });

		expect(updateAppSettings).toHaveBeenCalledWith({
			computeQueue: { niceness: 5 },
		});
	});

	test('an emptied field reverts on blur without writing', () => {
		renderRows({ concurrency: 3 });
		const input = screen.getByLabelText(
			'Compute queue slots',
		) as HTMLInputElement;

		fireEvent.change(input, { target: { value: '' } });
		fireEvent.blur(input);

		expect(updateAppSettings).not.toHaveBeenCalled();
		expect(input.value).toBe('3');
	});

	test('the other rows are disabled while the queue is off', () => {
		renderRows({ enabled: false });

		expect(
			(screen.getByLabelText('Compute queue slots') as HTMLInputElement)
				.disabled,
		).toBe(true);
		expect(
			(
				screen.getByLabelText(
					'Extra heavy command patterns, one per line',
				) as HTMLTextAreaElement
			).disabled,
		).toBe(true);
	});
});
