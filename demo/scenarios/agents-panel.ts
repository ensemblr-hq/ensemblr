import { DEMO_AGENT_HIERARCHY } from '../fixtures/agents.ts';
import { DEMO_MODEL_ROLE_APP_SETTINGS } from '../fixtures/models.ts';
import {
	DEMO_CLOCK,
	DEMO_GIT_FILES,
	DEMO_REPOSITORIES,
} from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import {
	assistantText,
	buildTranscript,
	reasoning,
	toolCall,
	toolResult,
	userPrompt,
} from '../transcript.ts';

const { leaves, manager, root } = DEMO_AGENT_HIERARCHY;

/** Expanded three-level orchestration tree with two visible leaf agents. */
export default defineScenario({
	appSettings: DEMO_MODEL_ROLE_APP_SETTINGS,
	chat: {
		...root,
		transcript: buildTranscript(root.branchId, DEMO_CLOCK, [
			userPrompt(
				'Refresh the demo catalog and show me every active workstream.',
			),
			reasoning(
				'The UI surfaces divide cleanly, so one manager coordinates the parallel implementation while I keep the integration boundary.',
			),
			toolCall('ensemblr_start_conversation', 'root-manager', {
				prompt:
					'Coordinate architecture, history, and settings demo scenarios.',
				title: manager.title,
			}),
			toolResult('root-manager', 'Manager opened with two leaf agents.'),
			toolCall('ensemblr_wait_for_agents', 'root-wait', {
				targets: [manager.agentSessionId],
				mode: 'all',
			}),
		]),
	},
	clock: DEMO_CLOCK,
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'agents-panel',
	label: 'Agents — active hierarchy',
	repositories: DEMO_REPOSITORIES,
	reviewTab: 'agents',
	route:
		'/projects/repo-ensemblr/workspaces/ws-release-notes/chats/demo-agent-root-tab',
	subAgents: [
		{
			...manager,
			transcript: buildTranscript(manager.branchId, DEMO_CLOCK, [
				userPrompt(
					'Coordinate architecture, history, and settings demo scenarios.',
				),
				reasoning(
					'Architecture and settings have separate fixtures and can be delegated without shared writes.',
				),
				toolCall('ensemblr_start_conversation', 'manager-architecture', {
					prompt: 'Stage architecture and history scenarios.',
					title: leaves[0]?.title,
				}),
				toolCall('ensemblr_start_conversation', 'manager-settings', {
					prompt: 'Stage settings and update scenarios.',
					title: leaves[1]?.title,
				}),
			]),
		},
		{
			...leaves[0],
			transcript: buildTranscript(leaves[0].branchId, DEMO_CLOCK, [
				userPrompt('Stage architecture and history scenarios.'),
				toolCall('read', 'architecture-read', {
					path: 'demo/fixtures/architecture.ts',
				}),
				toolResult('architecture-read', 'Five components, four connections.'),
				assistantText(
					'Architecture fixture is connected; history route is next.',
				),
			]),
		},
		{
			...leaves[1],
			transcript: buildTranscript(leaves[1].branchId, DEMO_CLOCK, [
				userPrompt('Stage settings and update scenarios.'),
				toolCall('read', 'settings-read', {
					path: 'demo/fixtures/updates.ts',
				}),
				toolResult('settings-read', 'Available and failure snapshots ready.'),
				assistantText('Update states are staged with current sidebar paths.'),
			]),
		},
	],
	workspaceId: 'ws-release-notes',
});
