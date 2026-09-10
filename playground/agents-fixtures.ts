import type { DynamicToolUIPart } from 'ai';

import { presentToolCall } from '@/renderer/lib/agent-timeline/tool-presentation';
import type {
	AgentContextReading,
	AgentConversation,
	AgentConversationActivity,
	AgentConversationStatus,
} from '@/renderer/types/agents';
import type { SessionTabModel } from '@/renderer/types/workbench';

/** A real content preview exercises pinning without treating an agent chat as ephemeral. */
export const AGENTS_FILE_PREVIEW: SessionTabModel = {
	agentSessionId: null,
	chatTabId: 'agents-file-preview',
	filePath:
		'src/renderer/components/workbench-shell/agents-panel/agents-panel.tsx',
	fullLabel:
		'src/renderer/components/workbench-shell/agents-panel/agents-panel.tsx',
	id: 'agents-file-preview',
	isPreview: true,
	isSubAgent: false,
	kind: 'file',
	label: 'agents-panel.tsx',
	status: 'idle',
	summary: '',
	updatedLabel: '',
};

export type AgentFixtureContext = 'last-recorded' | 'live' | 'unavailable';
export type AgentFixtureDensity = 'crowded' | 'default' | 'empty';
export type AgentFixtureTool = 'long' | 'none' | 'parallel' | 'single';

/** Builds an unresolved tool call for the shipped presentation mapper. */
function toolPart(
	toolName: string,
	input: Record<string, unknown>,
): DynamicToolUIPart {
	return {
		input,
		state: 'input-available',
		toolCallId: `${toolName}-agents-preview`,
		toolName,
		type: 'dynamic-tool',
	};
}

/** Converts a real tool presentation into the compact activity contract. */
function activityFromPart(
	part: DynamicToolUIPart,
	parallelCount?: number,
): AgentConversationActivity {
	const presentation = presentToolCall(part);
	const target =
		presentation.badge?.kind === 'file' || presentation.badge?.kind === 'folder'
			? presentation.badge.path
			: presentation.preview?.text;
	return { parallelCount, target, title: presentation.title };
}

/** Returns the tool preview selected by playground developer controls. */
function agentFixtureActivity(
	tool: AgentFixtureTool,
): AgentConversationActivity | null {
	if (tool === 'none') {
		return null;
	}
	if (tool === 'long') {
		return activityFromPart(
			toolPart('read', {
				path: 'src/renderer/components/workbench-shell/agents-panel/agents-panel.tsx',
			}),
		);
	}
	return activityFromPart(
		toolPart('read', { path: 'playground/agents-fixtures.ts' }),
		tool === 'parallel' ? 4 : undefined,
	);
}

/** Builds the reading selected by playground developer controls. */
function agentFixtureContext(
	reading: AgentFixtureContext,
): AgentConversation['contextUsage'] {
	if (reading === 'unavailable') {
		return null;
	}
	return {
		maxTokens: 200_000,
		reading: reading satisfies AgentContextReading,
		usedTokens: reading === 'live' ? 86_000 : 142_000,
	};
}

const BASE_CONVERSATIONS: readonly AgentConversation[] = [
	{
		chatTabId: 'root-roadmap',
		contextUsage: { maxTokens: 200_000, reading: 'live', usedTokens: 63_000 },
		depth: 0,
		isClosed: false,
		model: 'Claude Sonnet 4.5',
		parentChatTabId: null,
		runtime: 'claude',
		status: 'idle',
		title: 'Root roadmap',
	},
	{
		chatTabId: 'child-fixtures',
		contextUsage: null,
		depth: 1,
		isClosed: false,
		model: 'GPT-5.3 Codex',
		parentChatTabId: 'root-roadmap',
		runtime: 'pi',
		status: 'working',
		title: 'Build hierarchy fixtures',
	},
	{
		chatTabId: 'leaf-copy',
		contextUsage: { maxTokens: 128_000, reading: 'live', usedTokens: 91_000 },
		depth: 2,
		isClosed: false,
		model: 'Gemini 3.1 Pro',
		parentChatTabId: 'child-fixtures',
		runtime: 'pi',
		status: 'blocked',
		title:
			'Verify an intentionally very long leaf conversation title stays readable without taking over the rail',
	},
	{
		chatTabId: 'root-review',
		contextUsage: null,
		depth: 0,
		isClosed: false,
		model: null,
		parentChatTabId: null,
		status: 'idle',
		title: 'Review agent',
	},
	{
		chatTabId: 'closed-parent',
		contextUsage: {
			maxTokens: 200_000,
			reading: 'last-recorded',
			usedTokens: 118_000,
		},
		depth: 0,
		isClosed: true,
		model: 'Claude Sonnet 4.5',
		parentChatTabId: null,
		runtime: 'claude',
		status: 'idle',
		title: 'Closed parent with open work',
	},
	{
		chatTabId: 'orphan-child',
		contextUsage: { maxTokens: 200_000, reading: 'live', usedTokens: 21_000 },
		depth: 1,
		isClosed: false,
		model: 'GPT-5.3 Codex',
		parentChatTabId: 'closed-parent',
		runtime: 'pi',
		status: 'working',
		title: 'Continue after parent closed',
	},
	{
		chatTabId: 'closed-audit',
		contextUsage: {
			maxTokens: 200_000,
			reading: 'last-recorded',
			usedTokens: 74_000,
		},
		depth: 1,
		isClosed: true,
		model: 'GPT-5.3 Codex',
		parentChatTabId: 'root-roadmap',
		runtime: 'pi',
		status: 'idle',
		title: 'Closed architecture audit',
	},
];

/** Creates deterministic panel fixtures for one matrix/control permutation. */
export function createAgentConversations({
	context = 'live',
	density = 'default',
	status = 'working',
	tool = 'parallel',
}: {
	context?: AgentFixtureContext;
	density?: AgentFixtureDensity;
	status?: AgentConversationStatus;
	tool?: AgentFixtureTool;
} = {}): AgentConversation[] {
	if (density === 'empty') {
		return [];
	}
	const rows = BASE_CONVERSATIONS.map((conversation) => {
		if (conversation.chatTabId !== 'child-fixtures') {
			return { ...conversation };
		}
		return {
			...conversation,
			activity: status === 'working' ? agentFixtureActivity(tool) : null,
			contextUsage: agentFixtureContext(context),
			status,
		};
	});
	if (density !== 'crowded') {
		return rows;
	}
	return [
		...rows,
		...Array.from(
			{ length: 7 },
			(_, index): AgentConversation => ({
				chatTabId: `crowded-${index}`,
				contextUsage: null,
				depth: 1,
				isClosed: false,
				model: 'GPT-5.3 Codex',
				parentChatTabId: 'root-review',
				runtime: 'pi',
				status: index % 2 === 0 ? 'idle' : 'working',
				title: `Parallel fixture task ${index + 1}`,
			}),
		),
	];
}

/** Projects one conversation into the real horizontal session-tab model. */
export function agentSessionTab(
	conversation: AgentConversation,
): SessionTabModel {
	return {
		agentSessionId: `session-${conversation.chatTabId}`,
		chatTabId: conversation.chatTabId,
		delegationDepth: conversation.depth,
		id: conversation.chatTabId,
		isPreview: false,
		isSubAgent: conversation.depth > 0,
		kind: 'chat',
		label: conversation.title,
		parentChatTabId: conversation.parentChatTabId ?? undefined,
		status: conversation.status,
		summary: '',
		updatedLabel: '',
	};
}
