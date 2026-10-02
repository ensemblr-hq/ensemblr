import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { DemoBroadcastChannels } from '../../demo/demo-bridge';
import { createDemoHandlers } from '../../demo/handlers';
import { scenarioHref } from '../../demo/scenario';
import architecture from '../../demo/scenarios/architecture';
import { DEMO_SCENARIOS } from '../../demo/scenarios/index';
import updateFailure from '../../demo/scenarios/update-failure';
import { resolveUpdatePanelKind } from '../../src/renderer/state/updates/update-panel-kind';
import type { ListChatTabsResult } from '../../src/shared/ipc/contracts/chat-tab';

const NEW_SCENARIOS = [
	'agents-panel',
	'agents-history',
	'architecture',
	'workspace-history',
	'workspace-files',
	'linear-issue-detail',
	'harness-launcher',
	'update-available',
	'update-failure',
	'settings-appearance',
	'settings-environment',
	'settings-experimental',
	'settings-git',
	'settings-integrations',
	'settings-models',
	'repo-settings-actions',
	'repo-settings-environment',
	'repo-settings-git',
	'repo-settings-misc',
	'repo-settings-scripts',
	'repo-settings-secrets',
	'repo-settings-security',
];

describe('demo catalog integration', () => {
	test('registers every new screen with unique ids', () => {
		const ids = DEMO_SCENARIOS.map((scenario) => scenario.id);
		expect(ids).toHaveLength(47);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toEqual(expect.arrayContaining(NEW_SCENARIOS));
	});

	test('seeds synchronous shell queries before route navigation', () => {
		const source = readFileSync('demo/main.tsx', 'utf8');
		const seedPosition = source.indexOf(
			'queryClient.ensureQueryData(healthQuery)',
		);
		const navigationPosition = source.indexOf('await router.navigate');

		expect(seedPosition).toBeGreaterThan(-1);
		expect(navigationPosition).toBeGreaterThan(seedPosition);
	});

	test('opens a persisted architecture tab without requiring a backend mutation', () => {
		const handlers = createDemoHandlers(
			() => architecture,
			new DemoBroadcastChannels(),
		);
		const tabs = handlers.listChatTabs?.({
			workspaceId: architecture.workspaceId,
		}) as ListChatTabsResult;
		const diagram = tabs.open.find((tab) => tab.kind === 'diagram');
		expect(diagram).toBeDefined();
		expect(scenarioHref(architecture)).toContain(`/chats/${diagram?.id}`);
		expect(architecture.interactions).toEqual([]);
	});

	test('stages a visible download failure rather than a hidden update-check failure', () => {
		expect(resolveUpdatePanelKind(updateFailure.updateStatus ?? null)).toBe(
			'failed',
		);
	});
});
