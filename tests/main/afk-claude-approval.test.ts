import type {
	HookCallbackMatcher,
	HookEvent,
	HookJSONOutput,
	Options,
	Query,
	SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it } from 'vitest';

import type { AgentAdapterSession } from '../../src/main/agent-runtime/agent-adapter.ts';
import { createClaudeAgentAdapter } from '../../src/main/claude-agent/claude-agent-adapter.ts';
import type { ClaudeCanUseTool } from '../../src/main/claude-agent/claude-permission-bridge.ts';
import { CONTEXT_USAGE } from './helpers/claude-context-usage.ts';

const CONCIERGE_HOME = '/root/concierge';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	while (cleanups.length > 0) {
		await cleanups.pop()?.();
	}
});

// The adapter treats query completion as a shutdown, which would close the
// session before a test could submit into it.
function createPendingQuery(): Query {
	const iterator = (async function* (): AsyncGenerator<SDKMessage, void> {
		await new Promise<void>(() => undefined);
	})();
	return Object.assign(iterator, {
		applyFlagSettings: async () => undefined,
		close: () => undefined,
		getContextUsage: async () => CONTEXT_USAGE,
		interrupt: async () => undefined,
		setMaxThinkingTokens: async () => undefined,
		setModel: async () => undefined,
		setPermissionMode: async () => undefined,
	}) as unknown as Query;
}

/**
 * Opens one Claude session through the real adapter and hands back the SDK
 * options it installed, the session itself, and a log of every call that
 * reached the injected approval gate.
 * @param input - The chat's AFK flag at open, and whether it is the Concierge's.
 * @returns The installed options, the live session, and the gate's call log.
 */
async function openClaudeSession(
	input: { afkMode?: boolean; conciergeHome?: string } = {},
): Promise<{
	gateCalls: string[];
	options: Options;
	session: AgentAdapterSession;
}> {
	const gateCalls: string[] = [];
	const gate: ClaudeCanUseTool = async (toolName, toolInput) => {
		gateCalls.push(toolName);
		return { behavior: 'allow', updatedInput: toolInput };
	};
	let installed: Options | undefined;
	const adapter = createClaudeAgentAdapter({
		canUseTool: () => ({ canUseTool: gate, release: () => undefined }),
		queryFn: ({ options }) => {
			if (options) {
				installed = options;
			}
			return createPendingQuery();
		},
		resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
		resolveConciergeHome: () => input.conciergeHome ?? null,
	});
	const session = await adapter.createSession({
		metadata: {
			args: [],
			command: 'claude',
			cwd: '/tmp/ws',
			env: {},
			id: 'runtime-handle-1',
			label: 'Chat',
			model: null,
			piAgentDirectoryPreserved: true,
			provider: 'claude',
			sessionId: null,
			startedAt: '2026-09-05T00:00:00.000Z',
			status: 'starting',
			thinking: null,
			updatedAt: '2026-09-05T00:00:00.000Z',
		},
		request: {
			afkMode: input.afkMode,
			agentSessionId: 'session-1',
			permissionMode: 'approval-required',
			workspaceCwd: '/tmp/ws',
		},
	});
	cleanups.push(() => adapter.shutdown());
	if (!installed) {
		throw new Error('The adapter never called query().');
	}
	return { gateCalls, options: installed, session };
}

/** The per-call arguments the SDK's dispatcher hands `canUseTool`. */
const toolCallOptions = () => ({
	requestId: 'sdk-req',
	signal: new AbortController().signal,
	toolUseID: 'tool-use-1',
});

/** Runs the installed `canUseTool` against one tool call. */
const askToUse = async (
	options: Options,
	toolName: string,
	input: Record<string, unknown> = { command: 'ls' },
) => {
	const canUseTool = options.canUseTool;
	if (!canUseTool) {
		throw new Error('The adapter installed no canUseTool for the gated mode.');
	}
	return await canUseTool(toolName, input, toolCallOptions());
};

/** Runs every registered `PreToolUse` hook and collects the verdicts each rendered. */
const runPreToolUseHooks = async (
	hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined,
	toolName: string,
): Promise<HookJSONOutput[]> => {
	const matchers = hooks?.PreToolUse ?? [];
	const outputs: HookJSONOutput[] = [];
	for (const matcher of matchers) {
		for (const hook of matcher.hooks) {
			outputs.push(
				await hook(
					{
						hook_event_name: 'PreToolUse',
						tool_input: { file_path: '/etc/passwd' },
						tool_name: toolName,
					} as never,
					undefined,
					{ signal: new AbortController().signal },
				),
			);
		}
	}
	return outputs;
};

/** Whether any hook in the list refused the call. */
const anyDenied = (outputs: readonly HookJSONOutput[]) =>
	outputs.some(
		(output) =>
			'hookSpecificOutput' in output &&
			output.hookSpecificOutput &&
			'permissionDecision' in output.hookSpecificOutput &&
			output.hookSpecificOutput.permissionDecision === 'deny',
	);

// The per-tool card is the third surface that parks a turn on a human, alongside
// `ensemblr_ask_user_question` and the control-op confirmation. It only exists in
// `approval-required` — the same mode the control-op auto-approval covers — so a
// chat left AFK there would otherwise stall on its first edit.
describe('the per-tool approval card while the user is away', () => {
	it('resolves allowed without raising a card', async () => {
		const { gateCalls, options } = await openClaudeSession({ afkMode: true });

		expect(await askToUse(options, 'Edit')).toEqual({
			behavior: 'allow',
			updatedInput: { command: 'ls' },
		});
		expect(gateCalls).toEqual([]);
	});

	it('raises the card as usual while the user is present', async () => {
		const { gateCalls, options } = await openClaudeSession({ afkMode: false });

		await askToUse(options, 'Edit');

		expect(gateCalls).toEqual(['Edit']);
	});

	// AFK answers a question the permission mode already permits; it never widens
	// the mode. The Concierge's gate is containment rather than confirmation, so
	// it keeps refusing whatever the chip says.
	it('leaves the Concierge containment gate alone', async () => {
		const { options } = await openClaudeSession({
			afkMode: true,
			conciergeHome: CONCIERGE_HOME,
		});
		const decision = await askToUse(options, 'Write', {
			file_path: '/etc/passwd',
		});

		expect(decision?.behavior).toBe('deny');
	});
});

describe('the AFK hook alongside another surface', () => {
	it('runs the Concierge hook and the AFK hook rather than choosing', async () => {
		const { options } = await openClaudeSession({
			afkMode: true,
			conciergeHome: CONCIERGE_HOME,
		});

		expect(anyDenied(await runPreToolUseHooks(options.hooks, 'Write'))).toBe(
			true,
		);
		expect(
			anyDenied(await runPreToolUseHooks(options.hooks, 'AskUserQuestion')),
		).toBe(true);
	});

	it('registers the AFK hook on its own for a workspace chat', async () => {
		const { options } = await openClaudeSession({ afkMode: true });

		expect(
			anyDenied(await runPreToolUseHooks(options.hooks, 'AskUserQuestion')),
		).toBe(true);
		expect(anyDenied(await runPreToolUseHooks(options.hooks, 'Edit'))).toBe(
			false,
		);
	});
});

// The flag is a closure variable the hook and the gate read at call time, which
// is the whole reason it is not an SDK option — so a chip switched on during a
// running turn has to reach the turn already streaming.
describe('a chat that goes AFK mid-run', () => {
	it('refuses the question tool for the rest of the turn', async () => {
		const { options, session } = await openClaudeSession({ afkMode: false });

		expect(
			anyDenied(await runPreToolUseHooks(options.hooks, 'AskUserQuestion')),
		).toBe(false);

		await session.submit({
			afkMode: true,
			prompt: 'keep going',
			streamingBehavior: 'followUp',
		});

		expect(
			anyDenied(await runPreToolUseHooks(options.hooks, 'AskUserQuestion')),
		).toBe(true);
	});

	it('stops raising approval cards for the rest of the turn', async () => {
		const { gateCalls, options, session } = await openClaudeSession({
			afkMode: false,
		});

		await session.submit({
			afkMode: true,
			prompt: 'keep going',
			streamingBehavior: 'steer',
		});
		await askToUse(options, 'Edit');

		expect(gateCalls).toEqual([]);
	});

	it('raises them again once the user comes back', async () => {
		const { gateCalls, options, session } = await openClaudeSession({
			afkMode: true,
		});

		await session.submit({
			afkMode: false,
			prompt: 'I am back',
			streamingBehavior: 'followUp',
		});
		await askToUse(options, 'Edit');

		expect(gateCalls).toEqual(['Edit']);
	});
});
