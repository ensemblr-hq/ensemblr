import type { ListAgentHarnessesResult } from '@/shared/ipc/contracts/agents';

import type { DemoChat } from '../scenario.ts';

/** Installed-state catalog shown by the terminal harness launcher. */
export const DEMO_AGENT_HARNESSES: ListAgentHarnessesResult = {
	harnesses: [
		{ available: true, id: 'claude', label: 'Claude Code' },
		{ available: true, id: 'codex', label: 'OpenAI Codex' },
		{ available: false, id: 'vibe', label: 'Mistral Vibe' },
	],
};

/** Root-to-manager-to-leaves hierarchy for an expanded Agents panel. */
export const DEMO_AGENT_HIERARCHY = {
	root: {
		agentSessionId: 'demo-agent-root',
		currentTools: [
			{
				input: { targets: ['demo-agent-manager'], mode: 'all' },
				name: 'ensemblr_wait_for_agents',
				toolCallId: 'root-wait',
			},
		],
		branchId: 'demo-agent-root-branch',
		contextUsage: {
			reading: 'live',
			usage: { contextWindow: 1_000_000, percent: 22, tokens: 220_000 },
		},
		isStreaming: true,
		lineage: {
			depth: 0,
			parentSessionId: null,
			rootSessionId: 'demo-agent-root',
		},
		model: 'openai/gpt-5.4',
		provider: 'pi',
		tabId: 'demo-agent-root-tab',
		thinkingLevel: 'high',
		title: 'Refresh every demo screen',
		transcript: [],
	},
	manager: {
		agentSessionId: 'demo-agent-manager',
		branchId: 'demo-agent-manager-branch',
		contextUsage: {
			reading: 'live',
			usage: { contextWindow: 1_000_000, percent: 37, tokens: 370_000 },
		},
		currentTools: [
			{
				input: { path: 'demo/scenarios' },
				name: 'read',
				toolCallId: 'manager-read',
			},
		],
		isStreaming: true,
		lineage: {
			depth: 1,
			parentSessionId: 'demo-agent-root',
			rootSessionId: 'demo-agent-root',
		},
		model: 'claude-opus-5',
		provider: 'claude',
		tabId: 'demo-agent-manager-tab',
		thinkingLevel: 'high',
		title: 'Map new product surfaces',
		transcript: [],
	},
	leaves: [
		{
			agentSessionId: 'demo-agent-leaf-architecture',
			branchId: 'demo-agent-leaf-architecture-branch',
			contextUsage: {
				reading: 'live',
				usage: { contextWindow: 200_000, percent: 18, tokens: 36_000 },
			},
			currentTools: [
				{
					input: { path: 'demo/fixtures/architecture.ts' },
					name: 'read',
					toolCallId: 'leaf-architecture-read',
				},
			],
			isStreaming: true,
			lineage: {
				depth: 2,
				parentSessionId: 'demo-agent-manager',
				rootSessionId: 'demo-agent-root',
			},
			model: 'claude-sonnet-5',
			provider: 'claude',
			tabId: 'demo-agent-leaf-architecture-tab',
			thinkingLevel: 'medium',
			title: 'Stage architecture and history',
			transcript: [],
		},
		{
			agentSessionId: 'demo-agent-leaf-settings',
			branchId: 'demo-agent-leaf-settings-branch',
			contextUsage: {
				reading: 'last-recorded',
				usage: { contextWindow: 200_000, percent: 9, tokens: 18_000 },
			},
			isStreaming: false,
			lineage: {
				depth: 2,
				parentSessionId: 'demo-agent-manager',
				rootSessionId: 'demo-agent-root',
			},
			model: 'claude-sonnet-5',
			provider: 'claude',
			tabId: 'demo-agent-leaf-settings-tab',
			thinkingLevel: 'medium',
			title: 'Stage settings and updates',
			transcript: [],
		},
	],
} satisfies {
	leaves: readonly DemoChat[];
	manager: DemoChat;
	root: DemoChat;
};
