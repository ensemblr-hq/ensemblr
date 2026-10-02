import { describe, expect, test } from 'vitest';

import agentsHistory from '../../demo/scenarios/agents-history';
import agentsPanel from '../../demo/scenarios/agents-panel';
import architecture from '../../demo/scenarios/architecture';
import harnessLauncher from '../../demo/scenarios/harness-launcher';
import linearIssueDetail from '../../demo/scenarios/linear-issue-detail';
import updateAvailable from '../../demo/scenarios/update-available';
import updateFailure from '../../demo/scenarios/update-failure';
import workspaceFiles from '../../demo/scenarios/workspace-files';
import workspaceHistory from '../../demo/scenarios/workspace-history';

describe('demo workflow scenarios', () => {
	test('shows the complete root-manager-leaf hierarchy in the Agents panel', () => {
		expect(agentsPanel.reviewTab).toBe('agents');
		expect(agentsPanel.route).toContain('/chats/demo-agent-root-tab');
		expect(agentsPanel.chat.lineage?.depth).toBe(0);
		expect(agentsPanel.chat.currentTools).toEqual([
			expect.objectContaining({ name: 'ensemblr_wait_for_agents' }),
		]);
		expect(agentsPanel.subAgents.map((chat) => chat.lineage?.depth)).toEqual([
			1, 2, 2,
		]);
		expect(
			agentsPanel.subAgents.every((chat) => chat.transcript.length > 0),
		).toBe(true);
		expect(
			agentsPanel.subAgents.filter((chat) => chat.lineage?.depth === 2),
		).toHaveLength(2);
	});

	test('opens closed-agent history and keeps delegates restorable', () => {
		expect(agentsHistory.reviewTab).toBe('agents');
		expect(agentsHistory.subAgents.every((chat) => chat.closedAt)).toBe(true);
		expect(agentsHistory.interactions).toContainEqual(
			expect.objectContaining({ kind: 'click', text: 'Closed' }),
		);
	});

	test('configures architecture, history, issue detail, files, harnesses, and updates', () => {
		expect(architecture.architecture?.current).not.toBeNull();
		expect(architecture.appSettings?.experimental?.architectureDiagram).toBe(
			true,
		);
		expect(workspaceHistory.route).toBe('/history');
		expect(workspaceHistory.workspaceHistory?.entries.length).toBeGreaterThan(
			1,
		);
		expect(linearIssueDetail.route).toBe('/linear/issue-eng-412');
		const issueDetail =
			linearIssueDetail.linear?.issueDetails?.['issue-eng-412'];
		expect(issueDetail).toBeDefined();
		expect(issueDetail?.status === 'ok' && issueDetail.issue.stateId).toBe(
			'state-progress',
		);
		expect(workspaceFiles.reviewTab).toBe('files');
		expect(
			workspaceFiles.workspaceFiles.some((file) => file.name === '.env.local'),
		).toBe(true);
		expect(
			workspaceFiles.workspaceFiles.some((file) => file.symlinkTargetKind),
		).toBe(true);
		expect(harnessLauncher.appSettings?.experimental?.tuiHarnesses).toBe(true);
		expect(harnessLauncher.interactions).toContainEqual(
			expect.objectContaining({
				selector: 'button',
				text: 'Launch coding agent',
			}),
		);
		expect(updateAvailable.updateStatus?.state).toBe('available');
		expect(updateFailure.updateStatus?.state).toBe('error');
	});
});
