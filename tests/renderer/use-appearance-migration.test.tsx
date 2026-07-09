// @vitest-environment happy-dom
import { render, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { getAppSettings, updateAppSettings } = vi.hoisted(() => ({
	getAppSettings: vi.fn(),
	updateAppSettings: vi.fn(),
}));

vi.mock('@/renderer/api/ensemble', () => ({
	getAppSettings,
	updateAppSettings,
	subscribeAppSettingsChanged: () => () => undefined,
}));

import {
	appSettingsAtom,
	useAppearanceLegacyMigration,
} from '@/renderer/state/preferences';
import { DEFAULT_APP_SETTINGS } from '@/shared/config/app-settings';

function Probe() {
	useAppearanceLegacyMigration();
	return null;
}

/** Minimal in-memory `Storage` so the test controls the legacy keys directly. */
function createMemoryStorage(): Storage {
	const map = new Map<string, string>();
	return {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (key) => (map.has(key) ? (map.get(key) ?? null) : null),
		key: (index) => [...map.keys()][index] ?? null,
		removeItem: (key) => {
			map.delete(key);
		},
		setItem: (key, value) => {
			map.set(key, String(value));
		},
	};
}

let storage: Storage;

beforeEach(() => {
	storage = createMemoryStorage();
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: storage,
		writable: true,
	});
	getAppSettings.mockReset();
	updateAppSettings.mockReset();
});

describe('useAppearanceLegacyMigration', () => {
	test('does nothing when no legacy keys exist', async () => {
		render(
			<Provider store={createStore()}>
				<Probe />
			</Provider>,
		);
		await Promise.resolve();
		expect(getAppSettings).not.toHaveBeenCalled();
		expect(updateAppSettings).not.toHaveBeenCalled();
	});

	test('seeds config and clears legacy keys when config is at defaults', async () => {
		storage.setItem('ensemble_pref_theme', JSON.stringify('dark'));
		storage.setItem('ensemble_pref_mono_font', JSON.stringify('Fira Code'));
		getAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS);
		updateAppSettings.mockResolvedValue({
			...DEFAULT_APP_SETTINGS,
			appearance: {
				...DEFAULT_APP_SETTINGS.appearance,
				theme: 'dark',
				monoFont: 'Fira Code',
			},
		});
		const store = createStore();
		render(
			<Provider store={store}>
				<Probe />
			</Provider>,
		);
		await waitFor(() => expect(updateAppSettings).toHaveBeenCalledTimes(1));
		expect(updateAppSettings).toHaveBeenCalledWith({
			appearance: { theme: 'dark', monoFont: 'Fira Code' },
		});
		await waitFor(() =>
			expect(storage.getItem('ensemble_pref_theme')).toBeNull(),
		);
		expect(storage.getItem('ensemble_pref_mono_font')).toBeNull();
		expect(store.get(appSettingsAtom).appearance.theme).toBe('dark');
	});

	test('skips the write but still clears legacy keys when config already changed', async () => {
		storage.setItem('ensemble_pref_theme', JSON.stringify('dark'));
		getAppSettings.mockResolvedValue({
			...DEFAULT_APP_SETTINGS,
			appearance: { ...DEFAULT_APP_SETTINGS.appearance, theme: 'light' },
		});
		render(
			<Provider store={createStore()}>
				<Probe />
			</Provider>,
		);
		await waitFor(() =>
			expect(storage.getItem('ensemble_pref_theme')).toBeNull(),
		);
		expect(updateAppSettings).not.toHaveBeenCalled();
	});

	test('remaps the renamed one-dark code theme to one-dark-pro', async () => {
		storage.setItem('ensemble_pref_code_theme', JSON.stringify('one-dark'));
		getAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS);
		updateAppSettings.mockResolvedValue({
			...DEFAULT_APP_SETTINGS,
			appearance: {
				...DEFAULT_APP_SETTINGS.appearance,
				codeTheme: 'one-dark-pro',
			},
		});
		render(
			<Provider store={createStore()}>
				<Probe />
			</Provider>,
		);
		await waitFor(() => expect(updateAppSettings).toHaveBeenCalledTimes(1));
		expect(updateAppSettings).toHaveBeenCalledWith({
			appearance: { codeTheme: 'one-dark-pro' },
		});
	});

	test('drops non-JSON legacy values but still clears their keys', async () => {
		storage.setItem('ensemble_pref_theme', JSON.stringify('dark'));
		// Stored without JSON encoding: JSON.parse throws, so the field is dropped.
		storage.setItem('ensemble_pref_mono_font', 'Fira Code');
		getAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS);
		updateAppSettings.mockResolvedValue({
			...DEFAULT_APP_SETTINGS,
			appearance: { ...DEFAULT_APP_SETTINGS.appearance, theme: 'dark' },
		});
		render(
			<Provider store={createStore()}>
				<Probe />
			</Provider>,
		);
		await waitFor(() => expect(updateAppSettings).toHaveBeenCalledTimes(1));
		expect(updateAppSettings).toHaveBeenCalledWith({
			appearance: { theme: 'dark' },
		});
		await waitFor(() =>
			expect(storage.getItem('ensemble_pref_mono_font')).toBeNull(),
		);
		expect(storage.getItem('ensemble_pref_theme')).toBeNull();
	});

	test('keeps legacy keys when the persistence write fails', async () => {
		storage.setItem('ensemble_pref_theme', JSON.stringify('dark'));
		getAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS);
		updateAppSettings.mockRejectedValue(new Error('persist failed'));
		render(
			<Provider store={createStore()}>
				<Probe />
			</Provider>,
		);
		await waitFor(() => expect(updateAppSettings).toHaveBeenCalledTimes(1));
		// Drain the microtasks so the migration's catch branch has run.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(storage.getItem('ensemble_pref_theme')).toBe(JSON.stringify('dark'));
	});
});
