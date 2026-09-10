// @vitest-environment happy-dom

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDefaultStore } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ModelOrchestrationSettings } from '@/renderer/components/settings/models/model-orchestration-settings';
import {
	appSettingsAtom,
	modelOrchestrationWriteErrorAtom,
	modelRoleAssignmentsAtom,
} from '@/renderer/state/preferences';
import { type AppSettings, DEFAULT_APP_SETTINGS } from '@/shared/config';
import {
	type AgentModelOption,
	asModelVendorId,
} from '@/shared/ipc/contracts/agent-models';
import { renderWithProviders } from './support/dom';

const settingsApi = vi.hoisted(() => ({
	getAppSettings: vi.fn(),
	updateAppSettings: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
	Link: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/renderer/api/ensemblr', () => ({
	getAppSettings: (...args: unknown[]) => settingsApi.getAppSettings(...args),
	subscribeAppSettingsChanged: () => () => undefined,
	updateAppSettings: (...args: unknown[]) =>
		settingsApi.updateAppSettings(...args),
}));

/** Builds a catalog model with only the fields the settings control displays. */
function model(input: {
	displayName: string;
	id: string;
	runtime: 'claude' | 'pi';
	vendor: string;
}): AgentModelOption {
	return {
		agentProvider: input.runtime,
		contextWindow: null,
		displayName: input.displayName,
		id: input.id,
		thinkingLevels: [],
		vendor: asModelVendorId(input.vendor),
	};
}

const MODELS = [
	model({
		displayName: 'Pi Model',
		id: 'shared',
		runtime: 'pi',
		vendor: 'openai-codex',
	}),
	model({
		displayName: 'Claude Model',
		id: 'shared',
		runtime: 'claude',
		vendor: 'claude-code',
	}),
];

/** Renders the orchestration rows with the requested discovery state. */
function renderSettings(
	input: {
		error?: Error | null;
		isLoading?: boolean;
		models?: readonly AgentModelOption[];
	} = {},
) {
	return renderWithProviders(
		<ModelOrchestrationSettings
			error={input.error ?? null}
			isLoading={input.isLoading ?? false}
			models={input.models ?? MODELS}
		/>,
	);
}

describe('model orchestration settings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getDefaultStore().set(appSettingsAtom, DEFAULT_APP_SETTINGS);
		getDefaultStore().set(modelOrchestrationWriteErrorAtom, null);
		settingsApi.getAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS);
		settingsApi.updateAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS);
	});

	test('persists multiple roles independently for the same id across runtimes', async () => {
		const user = userEvent.setup();
		renderSettings();

		expect(screen.getAllByRole('combobox')).toHaveLength(5);
		expect(screen.queryByRole('definition')).not.toBeInTheDocument();
		for (const [role, modelName] of [
			['Coder', 'Pi Model'],
			['Builder', 'Pi Model'],
			['Sage', 'Claude Model'],
		]) {
			await user.click(
				screen.getByRole('combobox', { name: `Models for ${role}` }),
			);
			await user.click(
				await screen.findByRole('option', { name: new RegExp(modelName) }),
			);
			await user.keyboard('{Escape}');
		}

		expect(screen.getAllByText('Pi Model')).toHaveLength(2);
		expect(screen.getByText('Claude Model')).toBeVisible();
		await waitFor(() =>
			expect(settingsApi.updateAppSettings).toHaveBeenLastCalledWith({
				models: {
					roleAssignments: [
						{
							modelId: 'shared',
							roles: ['coder', 'builder'],
							runtime: 'pi',
						},
						{
							modelId: 'shared',
							roles: ['sage'],
							runtime: 'claude',
						},
					],
				},
			}),
		);
	});

	test('searches model names, ids, runtimes, and provider names with visible origin hints', async () => {
		const user = userEvent.setup();
		renderSettings();
		const input = screen.getByRole('combobox', { name: 'Models for Sage' });
		expect(input).toHaveAttribute(
			'placeholder',
			'Search models, runtimes, providers…',
		);
		for (const [query, expected] of [
			['Pi Model', 'Pi Model'],
			['Pi', 'Pi Model'],
			['OpenAI Codex', 'Pi Model'],
			['openai-codex', 'Pi Model'],
			['Claude Code', 'Claude Model'],
		]) {
			await user.clear(input);
			await user.type(input, query);
			expect(await screen.findAllByRole('option')).toHaveLength(1);
			expect(screen.getByRole('option')).toHaveTextContent(expected);
		}
		await user.clear(input);
		await user.type(input, 'shared');
		expect(await screen.findAllByRole('option')).toHaveLength(2);
		const pi = screen.getByRole('option', { name: /Pi Model/ });
		expect(within(pi).getByText('OpenAI Codex')).toBeVisible();
		expect(pi).toHaveAttribute('aria-label', 'Pi Model · Pi · OpenAI Codex');
		expect(pi).toHaveAttribute('title', 'Pi · OpenAI Codex · shared');
	});

	test('adds multiple model chips by keyboard and removes only the chosen role', async () => {
		const user = userEvent.setup();
		getDefaultStore().set(appSettingsAtom, {
			...DEFAULT_APP_SETTINGS,
			models: {
				...DEFAULT_APP_SETTINGS.models,
				roleAssignments: [
					{ modelId: 'shared', roles: ['builder'], runtime: 'pi' },
					{ modelId: 'hidden', roles: ['sage'], runtime: 'pi' },
					{ modelId: 'missing', roles: ['sage'], runtime: 'claude' },
				],
				hiddenModels: ['hidden'],
			},
		});
		renderSettings({
			models: [
				...MODELS,
				model({
					displayName: 'Hidden Model',
					id: 'hidden',
					runtime: 'pi',
					vendor: 'openai',
				}),
			],
		});
		const input = screen.getByRole('combobox', { name: 'Models for Sage' });
		await user.click(input);
		expect(
			screen.queryByRole('option', { name: /Hidden Model/ }),
		).not.toBeInTheDocument();
		await user.type(input, 'Pi Model');
		await waitFor(() =>
			expect(screen.getByRole('option', { name: /Pi Model/ })).toHaveAttribute(
				'data-highlighted',
			),
		);
		await user.keyboard('{Enter}');
		expect(
			getDefaultStore().get(appSettingsAtom).models.roleAssignments,
		).toEqual(
			expect.arrayContaining([
				{ modelId: 'shared', roles: ['builder', 'sage'], runtime: 'pi' },
			]),
		);
		expect(input).not.toHaveAttribute('placeholder');
		await user.clear(input);
		await user.type(input, 'Claude Model');
		await waitFor(() =>
			expect(
				screen.getByRole('option', { name: /Claude Model/ }),
			).toHaveAttribute('data-highlighted'),
		);
		await user.keyboard('{Enter}{Escape}');
		expect(input).toHaveFocus();
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
		await user.click(
			screen.getByRole('button', { name: 'Remove Pi Model (Pi) from Sage' }),
		);
		await user.click(
			screen.getByRole('button', {
				name: 'Remove Claude Model (Claude Code) from Sage',
			}),
		);
		await waitFor(() =>
			expect(settingsApi.updateAppSettings).toHaveBeenLastCalledWith({
				models: {
					roleAssignments: [
						{ modelId: 'hidden', roles: ['sage'], runtime: 'pi' },
						{ modelId: 'missing', roles: ['sage'], runtime: 'claude' },
						{ modelId: 'shared', roles: ['builder'], runtime: 'pi' },
					],
				},
			}),
		);
		expect(
			screen.getByRole('button', { name: 'Remove Pi Model (Pi) from Builder' }),
		).toBeVisible();
	});

	test('keeps an unavailable assignment visible until it is cleared', async () => {
		getDefaultStore().set(appSettingsAtom, {
			...DEFAULT_APP_SETTINGS,
			models: {
				...DEFAULT_APP_SETTINGS.models,
				roleAssignments: [
					{ modelId: 'missing', roles: ['sage'], runtime: 'claude' },
				],
			},
		});
		renderSettings();

		expect(screen.getByText('Unavailable saved assignments')).toBeVisible();
		expect(screen.getByText('missing')).toBeVisible();
		fireEvent.click(
			screen.getByRole('button', { name: 'Clear roles for missing' }),
		);

		await waitFor(() =>
			expect(settingsApi.updateAppSettings).toHaveBeenLastCalledWith({
				models: { roleAssignments: [] },
			}),
		);
	});

	test('keeps unavailable assignments recoverable when discovery fails', async () => {
		getDefaultStore().set(appSettingsAtom, {
			...DEFAULT_APP_SETTINGS,
			models: {
				...DEFAULT_APP_SETTINGS.models,
				roleAssignments: [
					{ modelId: 'missing', roles: ['sage'], runtime: 'claude' },
				],
			},
		});
		renderSettings({ error: new Error('offline'), models: [] });

		expect(
			screen.getByText('Model discovery failed: Error: offline.'),
		).toBeVisible();
		expect(screen.getByText('Unavailable saved assignments')).toBeVisible();
		expect(
			screen.getByRole('button', { name: 'Clear roles for missing' }),
		).toBeVisible();
	});

	test('reports a model-orchestration persistence failure visibly', async () => {
		settingsApi.updateAppSettings.mockRejectedValueOnce(new Error('disk full'));
		renderSettings();

		fireEvent.click(
			screen.getByRole('switch', {
				name: 'Allow cross-runtime delegation',
			}),
		);

		await waitFor(() =>
			expect(
				screen.getByText(
					'Could not save model orchestration settings. Your latest change may not be saved.',
				),
			).toBeVisible(),
		);
		expect(settingsApi.getAppSettings).toHaveBeenCalledOnce();
	});

	test('does not let a failed-write refresh overwrite a newer optimistic write', async () => {
		let rejectFirstWrite: (reason?: unknown) => void = () => undefined;
		let resolveRefresh: (settings: AppSettings) => void = () => undefined;
		const firstWrite = new Promise<AppSettings>((_resolve, reject) => {
			rejectFirstWrite = reject;
		});
		const refresh = new Promise<AppSettings>((resolve) => {
			resolveRefresh = resolve;
		});
		settingsApi.updateAppSettings.mockReturnValueOnce(firstWrite);
		settingsApi.getAppSettings.mockReturnValueOnce(refresh);
		const store = getDefaultStore();
		const firstAssignments: AppSettings['models']['roleAssignments'] = [
			{ modelId: 'first', roles: ['sage'], runtime: 'pi' },
		];
		const latestAssignments: AppSettings['models']['roleAssignments'] = [
			{ modelId: 'latest', roles: ['coder'], runtime: 'pi' },
		];

		store.set(modelRoleAssignmentsAtom, firstAssignments);
		rejectFirstWrite(new Error('disk full'));
		await waitFor(() =>
			expect(settingsApi.getAppSettings).toHaveBeenCalledOnce(),
		);
		store.set(modelRoleAssignmentsAtom, latestAssignments);
		resolveRefresh(DEFAULT_APP_SETTINGS);
		await refresh;
		await Promise.resolve();

		expect(store.get(modelRoleAssignmentsAtom)).toEqual(latestAssignments);
	});

	test('renders loading, discovery failure, empty, and no-match states', async () => {
		const user = userEvent.setup();
		const view = renderSettings({ isLoading: true });
		expect(screen.getByText('Loading models…')).toBeVisible();

		view.rerender(
			<ModelOrchestrationSettings
				error={new Error('offline')}
				isLoading={false}
				models={[]}
			/>,
		);
		expect(
			screen.getByText('Model discovery failed: Error: offline.'),
		).toBeVisible();

		view.rerender(
			<ModelOrchestrationSettings error={null} isLoading={false} models={[]} />,
		);
		expect(screen.getByText('No active delegation models')).toBeVisible();

		view.rerender(
			<ModelOrchestrationSettings
				error={null}
				isLoading={false}
				models={MODELS}
			/>,
		);
		await user.type(
			screen.getByRole('combobox', { name: 'Models for Sage' }),
			'no-such-model',
		);
		expect(await screen.findByText('No matching models.')).toBeVisible();
	});
});
