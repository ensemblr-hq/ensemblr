// @vitest-environment happy-dom

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ReadOnlyToolsRow } from '@/renderer/components/settings/agent-providers/read-only-tools-row';
import { appSettingsAtom } from '@/renderer/state/preferences';
import { DEFAULT_APP_SETTINGS } from '@/shared/config';
import type {
	AgentProviderToolWire,
	ListAgentProviderToolsResult,
} from '@/shared/ipc/contracts/agent-provider';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

const updateAppSettings = vi.fn(async () => undefined);
const listAgentProviderTools =
	vi.fn<() => Promise<ListAgentProviderToolsResult>>();

/** Builds one reported tool, defaulting every optional field to empty. */
function tool(
	name: string,
	overrides: Partial<AgentProviderToolWire> = {},
): AgentProviderToolWire {
	return {
		description: null,
		name,
		refused: false,
		source: null,
		...overrides,
	};
}

/** Renders the row inside a fresh Jotai store, optionally seeded with saved names. */
function renderRow(saved: string[] = [], provider: 'claude' | 'pi' = 'pi') {
	const store = createStore();
	store.set(appSettingsAtom, {
		...DEFAULT_APP_SETTINGS,
		providers: {
			...DEFAULT_APP_SETTINGS.providers,
			[provider === 'pi' ? 'piReadOnlyTools' : 'claudeReadOnlyTools']: saved,
		},
	});
	return renderWithProviders(
		<Provider store={store}>
			<ReadOnlyToolsRow provider={provider} />
		</Provider>,
	);
}

beforeEach(() => {
	updateAppSettings.mockClear();
	listAgentProviderTools.mockReset();
	installEnsemblrApi({
		getAppSettings: vi.fn(),
		listAgentProviderTools,
		updateAppSettings,
	});
});

afterEach(() => {
	clearEnsemblrApi();
});

describe('ReadOnlyToolsRow', () => {
	test('lists discovered tools by name with their source, description, and refused badge', async () => {
		listAgentProviderTools.mockResolvedValue({
			reported: true,
			tools: [
				tool('web_search', {
					description: 'Search the web',
					refused: true,
					source: 'npm:pi-web-access',
				}),
				tool('fetch_content'),
			],
		});
		renderRow();

		const items = await screen.findAllByRole('listitem');
		expect(items).toHaveLength(2);
		expect(within(items[0]).getByText('fetch_content')).toBeInTheDocument();
		expect(within(items[0]).queryByText('Refused')).not.toBeInTheDocument();
		expect(within(items[1]).getByText('web_search')).toBeInTheDocument();
		expect(within(items[1]).getByText('npm:pi-web-access')).toBeInTheDocument();
		expect(within(items[1]).getByText('Search the web')).toBeInTheDocument();
		expect(within(items[1]).getByText('Refused')).toBeInTheDocument();
	});

	test('switching a tool on saves a sorted providers patch', async () => {
		listAgentProviderTools.mockResolvedValue({
			reported: true,
			tools: [tool('web_search'), tool('fetch_content')],
		});
		renderRow();

		fireEvent.click(
			await screen.findByRole('switch', {
				name: 'Trust web_search as read-only',
			}),
		);
		expect(updateAppSettings).toHaveBeenLastCalledWith({
			providers: { piReadOnlyTools: ['web_search'] },
		});

		fireEvent.click(
			screen.getByRole('switch', { name: 'Trust fetch_content as read-only' }),
		);
		expect(updateAppSettings).toHaveBeenLastCalledWith({
			providers: { piReadOnlyTools: ['fetch_content', 'web_search'] },
		});
	});

	test('a saved name the inventory lacks keeps a row that switches off', async () => {
		listAgentProviderTools.mockResolvedValue({
			reported: true,
			tools: [tool('web_search')],
		});
		renderRow(['old_tool', 'web_search']);

		expect(
			await screen.findByText('Not seen since launch'),
		).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole('switch', { name: 'Trust old_tool as read-only' }),
		);
		expect(updateAppSettings).toHaveBeenLastCalledWith({
			providers: { piReadOnlyTools: ['web_search'] },
		});
	});

	test('rejects a name that already has a policy and saves a new one', async () => {
		listAgentProviderTools.mockResolvedValue({ reported: true, tools: [] });
		renderRow();
		const field = await screen.findByRole('textbox', {
			name: 'Tool name to trust',
		});

		fireEvent.change(field, { target: { value: '  bash ' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add' }));
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Ensemblr already has a rule for bash',
		);
		expect(updateAppSettings).not.toHaveBeenCalled();

		fireEvent.change(field, { target: { value: ' my_search ' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add' }));
		await waitFor(() =>
			expect(updateAppSettings).toHaveBeenCalledWith({
				providers: { piReadOnlyTools: ['my_search'] },
			}),
		);
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
		expect(field).toHaveValue('');
	});

	test('rejects an empty name and one that is already saved', async () => {
		listAgentProviderTools.mockResolvedValue({ reported: true, tools: [] });
		renderRow(['my_search']);
		const field = await screen.findByRole('textbox', {
			name: 'Tool name to trust',
		});

		fireEvent.click(screen.getByRole('button', { name: 'Add' }));
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Enter a tool name.',
		);

		fireEvent.change(field, { target: { value: 'my_search' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add' }));
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'my_search is already trusted.',
		);
		expect(updateAppSettings).not.toHaveBeenCalled();
	});

	// Claude Code's own built-ins are the app's to classify, so the form says
	// what can be trusted there rather than claiming a rule exists for the name.
	test('on Claude Code accepts only an MCP tool name', async () => {
		listAgentProviderTools.mockResolvedValue({ reported: true, tools: [] });
		renderRow([], 'claude');
		const field = await screen.findByRole('textbox', {
			name: 'Tool name to trust',
		});

		fireEvent.change(field, { target: { value: 'Monitor' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add' }));
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'On Claude Code only MCP tools can be trusted',
		);
		expect(updateAppSettings).not.toHaveBeenCalled();

		fireEvent.change(field, { target: { value: 'mcp__exa__search' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add' }));
		await waitFor(() =>
			expect(updateAppSettings).toHaveBeenCalledWith({
				providers: { claudeReadOnlyTools: ['mcp__exa__search'] },
			}),
		);
	});

	// Main drops a saved name the app decides about itself, so the row must not
	// look like it clears the tool — and must still let the user remove it.
	test('marks a saved name main ignores and still lets it be removed', async () => {
		listAgentProviderTools.mockResolvedValue({ reported: true, tools: [] });
		renderRow(['Monitor', 'mcp__exa__search'], 'claude');

		const rowOf = async (name: string) => {
			const label = await screen.findByText(name);
			const item = label.closest('li');
			if (!item) {
				throw new Error(`No row for ${name}`);
			}
			return item;
		};
		const ignored = 'Ignored: Ensemblr decides about this tool itself.';

		expect(
			within(await rowOf('Monitor')).getByText(ignored),
		).toBeInTheDocument();
		expect(
			within(await rowOf('mcp__exa__search')).queryByText(ignored),
		).not.toBeInTheDocument();

		fireEvent.click(
			screen.getByRole('switch', { name: 'Trust Monitor as read-only' }),
		);
		expect(updateAppSettings).toHaveBeenLastCalledWith({
			providers: { claudeReadOnlyTools: ['mcp__exa__search'] },
		});
	});

	test('rejects a name longer than a tool name can be', async () => {
		listAgentProviderTools.mockResolvedValue({ reported: true, tools: [] });
		renderRow();
		const field = await screen.findByRole('textbox', {
			name: 'Tool name to trust',
		});

		fireEvent.change(field, { target: { value: 'x'.repeat(201) } });
		fireEvent.click(screen.getByRole('button', { name: 'Add' }));
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Tool names are at most 200 characters long.',
		);
		expect(updateAppSettings).not.toHaveBeenCalled();
	});

	test('drops the Refused badge once the tool is trusted', async () => {
		listAgentProviderTools.mockResolvedValue({
			reported: true,
			tools: [tool('exa_search', { refused: true })],
		});
		renderRow(['exa_search']);

		expect(await screen.findByText('exa_search')).toBeInTheDocument();
		expect(screen.queryByText('Refused')).not.toBeInTheDocument();
	});

	test('says nothing is known yet when no session has reported', async () => {
		listAgentProviderTools.mockResolvedValue({ reported: false, tools: [] });
		renderRow();

		expect(
			await screen.findByText(
				'Start a conversation on this runtime to list the extra tools it holds.',
			),
		).toBeInTheDocument();
		expect(screen.queryByText('No extra tools found.')).not.toBeInTheDocument();
	});

	test('says no extra tools exist once a session has reported an empty list', async () => {
		listAgentProviderTools.mockResolvedValue({ reported: true, tools: [] });
		renderRow();

		expect(
			await screen.findByText('No extra tools found.'),
		).toBeInTheDocument();
	});
});
