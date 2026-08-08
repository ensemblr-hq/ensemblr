// @vitest-environment happy-dom

import { screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactElement } from 'react';
import { describe, expect, test } from 'vitest';

import { SubAgentStatusPanel } from '../../src/renderer/components/workbench-shell/conversation-panel/sub-agent-status-panel';
import { appSettingsAtom } from '../../src/renderer/state/preferences';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/config';
import { createComposerShellState } from './support/composer';
import { renderWithProviders } from './support/dom';

const CLAUDE_MODELS = [
	{
		agentProvider: 'claude' as const,
		contextWindow: 200_000,
		displayName: 'Opus 5',
		id: 'claude-code/opus',
		isDefault: true,
		provider: 'claude-code',
	},
];

const CLAUDE_LEVELS = [
	{ id: 'off', label: 'Off' },
	{ id: 'high', label: 'High' },
];

const claudeComposer = (
	overrides: Parameters<typeof createComposerShellState>[0] = {},
) =>
	createComposerShellState({
		availableModels: CLAUDE_MODELS,
		availableThinkingLevels: CLAUDE_LEVELS,
		lockedProvider: 'claude',
		modelId: 'claude-code/opus',
		thinkingLevel: 'high',
		...overrides,
	});

const renderPanel = (ui: ReactElement, alwaysShowContextUsage = false) => {
	const store = createStore();
	store.set(appSettingsAtom, {
		...DEFAULT_APP_SETTINGS,
		general: { ...DEFAULT_APP_SETTINGS.general, alwaysShowContextUsage },
	});
	renderWithProviders(<Provider store={store}>{ui}</Provider>);
};

const getPanel = () =>
	screen.getByRole('complementary', { name: 'Sub-agent runtime' });

const queryGauge = () =>
	screen.queryByRole('button', { name: 'Context usage' });

describe('sub-agent status panel', () => {
	test('names the model and thinking level the child is running', () => {
		renderPanel(<SubAgentStatusPanel composer={claudeComposer()} />);

		const panel = within(getPanel());
		expect(panel.getByText('Opus 5')).toBeVisible();
		expect(panel.getByText('High')).toBeVisible();
	});

	// The composer's thinking chip hides its label at strength zero; a status
	// readout must not, or "off" is indistinguishable from "not reported".
	test('still names the thinking level when thinking is off', () => {
		renderPanel(
			<SubAgentStatusPanel
				composer={claudeComposer({ thinkingLevel: 'off' })}
			/>,
		);

		expect(within(getPanel()).getByText('Off')).toBeVisible();
	});

	test('renders nothing before the child has an agent session', () => {
		renderPanel(
			<SubAgentStatusPanel
				composer={claudeComposer({ activeAgentSessionId: null })}
			/>,
		);

		expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
	});

	test('withholds the context gauge at quiet usage', () => {
		renderPanel(
			<SubAgentStatusPanel
				composer={claudeComposer({
					contextUsage: { maxTokens: 200_000, usedTokens: 20_000 },
				})}
			/>,
		);

		expect(queryGauge()).not.toBeInTheDocument();
	});

	test('shows the context gauge once usage passes the threshold', () => {
		renderPanel(
			<SubAgentStatusPanel
				composer={claudeComposer({
					contextUsage: { maxTokens: 200_000, usedTokens: 160_000 },
				})}
			/>,
		);

		expect(queryGauge()).toBeInTheDocument();
	});

	test('shows the context gauge at quiet usage when the preference forces it', () => {
		renderPanel(
			<SubAgentStatusPanel
				composer={claudeComposer({
					contextUsage: { maxTokens: 200_000, usedTokens: 20_000 },
				})}
			/>,
			true,
		);

		expect(queryGauge()).toBeInTheDocument();
	});

	test('reports the catalog gap plainly when the model is not yet known', () => {
		renderPanel(
			<SubAgentStatusPanel
				composer={createComposerShellState({ modelId: 'claude-code/opus' })}
			/>,
		);

		expect(within(getPanel()).getByText('Model pending')).toBeVisible();
	});
});
