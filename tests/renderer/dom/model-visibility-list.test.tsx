// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ModelVisibilityList } from '@/renderer/components/settings/model-visibility-list';
import {
	appSettingsAtom,
	hiddenModelsAtom,
} from '@/renderer/state/preferences';
import { DEFAULT_APP_SETTINGS } from '@/shared/config';
import type { AgentModelCatalog } from '@/shared/ipc/contracts/agent-models';
import { asModelVendorId } from '@/shared/ipc/contracts/agent-models';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from '../support/dom';

const CATALOG: AgentModelCatalog = {
	defaultModelId: 'current/alpha',
	defaultThinkingLevel: 'medium',
	models: [
		{
			agentProvider: 'pi',
			contextWindow: 200_000,
			displayName: 'Alpha',
			id: 'current/alpha',
			thinkingLevels: ['off', 'medium', 'high'],
			vendor: asModelVendorId('current'),
		},
		{
			agentProvider: 'pi',
			contextWindow: 200_000,
			displayName: 'Beta',
			id: 'current/beta',
			thinkingLevels: ['off', 'medium', 'high'],
			vendor: asModelVendorId('current'),
		},
	],
};

afterEach(() => {
	clearEnsemblrApi();
});

describe('ModelVisibilityList', () => {
	test('can hide a current model when settings contain a removed hidden model', async () => {
		const updateAppSettings = vi.fn().mockResolvedValue(undefined);
		installEnsemblrApi({
			listAgentModels: vi.fn().mockResolvedValue(CATALOG),
			updateAppSettings,
		});
		const store = createStore();
		store.set(appSettingsAtom, {
			...DEFAULT_APP_SETTINGS,
			models: {
				...DEFAULT_APP_SETTINGS.models,
				hiddenModels: ['removed/legacy'],
			},
		});

		renderWithProviders(
			<Provider store={store}>
				<ModelVisibilityList />
			</Provider>,
		);

		const alpha = await screen.findByRole('switch', { name: 'Hide Alpha' });
		expect(alpha).toBeEnabled();
		await userEvent.click(alpha);

		expect(store.get(hiddenModelsAtom)).toEqual([
			'removed/legacy',
			'current/alpha',
		]);
		expect(updateAppSettings).toHaveBeenCalledWith({
			models: { hiddenModels: ['removed/legacy', 'current/alpha'] },
		});
	});
});
