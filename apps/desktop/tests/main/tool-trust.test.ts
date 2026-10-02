import type { HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, test, vi } from 'vitest';

import { createToolTrustService } from '../../src/main/agent-providers/tool-trust.ts';
import { createConciergeSessionGate } from '../../src/main/claude-agent/claude-concierge-guard.ts';
import { withholdsControlTools } from '../../src/main/claude-agent/claude-permission-bridge.ts';
import { withPlanModeHooks } from '../../src/main/claude-agent/claude-plan-mode-guard.ts';
import {
	type ClaudeToolTrust,
	describeClaudeTools,
} from '../../src/main/claude-agent/claude-tool-trust.ts';
import type { ProviderSettings } from '../../src/shared/config.ts';
import type { PermissionMode } from '../../src/shared/permissions.ts';
import {
	acceptsUserTrust,
	evaluateConciergeTool,
	evaluatePlanModeTool,
	toTrustedToolSet,
} from '../../src/shared/plan-mode.ts';

const HOME = '/root/concierge';

const providers = (
	overrides: Partial<ProviderSettings> = {},
): ProviderSettings => ({
	claudeReadOnlyTools: [],
	claudeSubagentMode: 'ensemblr',
	piReadOnlyTools: [],
	...overrides,
});

describe('which tools a user may vouch for', () => {
	// Every one of these already has a policy — a classifier, a path check, a
	// built-in clearance — so a user's word would either change nothing or
	// overturn a verdict it must never overturn.
	test.each([
		'bash',
		'write',
		'edit',
		'read',
		'web_search',
		'ensemblr_start_conversation',
		'',
		'x'.repeat(201),
	])('refuses %s on Pi', (tool) => {
		expect(acceptsUserTrust(tool, 'pi')).toBe(false);
	});

	// A shell the bash classifier cannot read, and two dispatchers whose name
	// says nothing about what they call: vouching for the name would vouch for
	// every writer behind it.
	test.each(['powershell', 'mcp', 'mcpScript'])('never trusts %s', (tool) => {
		expect(acceptsUserTrust(tool, 'pi')).toBe(false);
	});

	test.each(['exa_search', 'context_lookup', 'mcp__context7'])(
		'offers the Pi extension tool %s',
		(tool) => {
			expect(acceptsUserTrust(tool, 'pi')).toBe(true);
		},
	);

	// Claude Code's own built-ins are the app's to classify: the read-only ones
	// are cleared already, and the rest act — `Monitor` runs a command the bash
	// classifier never sees, `EnterWorktree` moves git, `Workflow` spawns writers.
	test.each([
		'Bash',
		'Write',
		'MultiEdit',
		'Read',
		'WebSearch',
		'Monitor',
		'Workflow',
		'EnterWorktree',
		'CronCreate',
		'PowerShell',
		'exa_search',
		'mcp__ensemblr__ensemblr_list_workspaces',
	])('refuses %s on Claude Code', (tool) => {
		expect(acceptsUserTrust(tool, 'claude')).toBe(false);
	});

	test.each(['mcp__exa__web_search_exa', 'mcp__context7__query-docs'])(
		'offers the Claude Code MCP tool %s',
		(tool) => {
			expect(acceptsUserTrust(tool, 'claude')).toBe(true);
		},
	);

	test('strips a hand-edited list down to what a user may vouch for', () => {
		expect([
			...toTrustedToolSet(
				[' exa_search ', 'bash', 'powershell', 'mcp', 'write', ''],
				'pi',
			),
		]).toEqual(['exa_search']);
		expect([
			...toTrustedToolSet(['Monitor', 'mcp__exa__search', 'Bash'], 'claude'),
		]).toEqual(['mcp__exa__search']);
	});
});

describe('the user’s word in the shared guards', () => {
	const trusted = toTrustedToolSet(['exa_search'], 'pi');

	test('clears a trusted tool for the Concierge', () => {
		expect(
			evaluateConciergeTool({
				conciergeHome: HOME,
				tool: 'exa_search',
				trustedTools: trusted,
			}),
		).toEqual({ blocked: false });
	});

	test('clears a trusted tool while planning', () => {
		expect(
			evaluatePlanModeTool({ tool: 'exa_search', trustedTools: trusted }),
		).toEqual({ blocked: false });
	});

	test('still refuses a tool nobody vouched for, naming where to vouch', () => {
		for (const result of [
			evaluateConciergeTool({
				conciergeHome: HOME,
				tool: 'mystery_tool',
				trustedTools: trusted,
			}),
			evaluatePlanModeTool({ tool: 'mystery_tool', trustedTools: trusted }),
		]) {
			expect(result.blocked).toBe(true);
			expect(result.reason).toContain('Settings → Providers → Read-only tools');
		}
	});

	// The guards consult the list last, so even a raw set that skipped
	// `toTrustedToolSet` cannot lift the write, shell, or never-trusted rules.
	test('never overturns a write, shell, or never-trusted verdict', () => {
		const raw = new Set(['write', 'bash', 'powershell', 'mcp']);
		expect(
			evaluateConciergeTool({
				conciergeHome: HOME,
				path: '/etc/hosts',
				tool: 'write',
				trustedTools: raw,
			}).blocked,
		).toBe(true);
		expect(
			evaluateConciergeTool({
				command: 'rm -rf /',
				conciergeHome: HOME,
				tool: 'bash',
				trustedTools: raw,
			}).blocked,
		).toBe(true);
		expect(
			evaluatePlanModeTool({ tool: 'write', trustedTools: raw }).blocked,
		).toBe(true);
		for (const tool of ['powershell', 'mcp']) {
			expect(
				evaluateConciergeTool({ conciergeHome: HOME, tool, trustedTools: raw })
					.blocked,
			).toBe(true);
			expect(evaluatePlanModeTool({ tool, trustedTools: raw }).blocked).toBe(
				true,
			);
		}
	});

	// Researching is what planning is for, and these four reach no workspace.
	test.each([
		'web_search',
		'fetch_content',
		'get_search_content',
		'source_check',
	])('clears the web-access tool %s while planning', (tool) => {
		expect(evaluatePlanModeTool({ tool })).toEqual({ blocked: false });
	});
});

describe('the tool-trust service', () => {
	test('reads the saved list per call, so a change applies at once', () => {
		let saved = providers({ piReadOnlyTools: ['exa_search'] });
		const service = createToolTrustService(() => saved);

		expect([...service.trustedTools('pi')]).toEqual(['exa_search']);
		expect([...service.trustedTools('claude')]).toEqual([]);

		saved = providers({ piReadOnlyTools: [] });
		expect([...service.trustedTools('pi')]).toEqual([]);
	});

	test('reports nothing for a runtime no session has reported yet', () => {
		const service = createToolTrustService(() => providers());

		expect(service.listTools('pi')).toEqual({ reported: false, tools: [] });
	});

	test('lists only the reported tools a user could vouch for, sorted', () => {
		const service = createToolTrustService(() => providers());

		service.recordInventory('pi', [
			{
				description: 'Searches Exa\nSecond line',
				name: 'exa_search',
				source: 'npm:pi-exa',
			},
			{ description: 'Runs a shell', name: 'bash', source: 'builtin' },
			{ description: null, name: 'mcp', source: 'npm:pi-mcp-adapter' },
			{ description: null, name: 'context_lookup', source: 'local' },
		]);

		expect(service.listTools('pi')).toEqual({
			reported: true,
			tools: [
				{
					description: null,
					name: 'context_lookup',
					refused: false,
					source: 'local',
				},
				{
					description: 'Searches Exa',
					name: 'exa_search',
					refused: false,
					source: 'npm:pi-exa',
				},
			],
		});
	});

	test('badges a refused tool, and lists one it never saw reported', () => {
		const service = createToolTrustService(() => providers());

		service.recordInventory('pi', [
			{ description: null, name: 'exa_search', source: 'npm:pi-exa' },
		]);
		service.recordRefusal('pi', 'exa_search');
		service.recordRefusal('pi', ' late_tool ');
		service.recordRefusal('pi', 'write');
		service.recordRefusal('pi', 'x'.repeat(201));

		expect(service.listTools('pi').tools).toEqual([
			{
				description: null,
				name: 'exa_search',
				refused: true,
				source: 'npm:pi-exa',
			},
			{ description: null, name: 'late_tool', refused: true, source: null },
		]);
	});

	test('keeps each runtime’s inventory apart', () => {
		const service = createToolTrustService(() => providers());

		service.recordInventory('claude', [
			{ description: null, name: 'mcp__exa__search', source: 'exa' },
		]);

		expect(service.listTools('pi').reported).toBe(false);
		expect(service.listTools('claude').tools.map((tool) => tool.name)).toEqual([
			'mcp__exa__search',
		]);
	});

	// A Claude session's `init` lists its built-ins beside its MCP tools, and a
	// built-in the Settings list offered would be one a switch could clear.
	test('never offers a Claude Code built-in, whatever `init` lists', () => {
		const service = createToolTrustService(() => providers());

		service.recordInventory(
			'claude',
			describeClaudeTools(['Monitor', 'Read', 'Workflow', 'mcp__exa__search']),
		);
		service.recordRefusal('claude', 'EnterWorktree');

		expect(service.listTools('claude').tools.map((tool) => tool.name)).toEqual([
			'mcp__exa__search',
		]);
	});

	test('ignores a hand-edited Claude Code built-in in the saved list', () => {
		const service = createToolTrustService(() =>
			providers({ claudeReadOnlyTools: ['Monitor', 'mcp__exa__search'] }),
		);

		expect([...service.trustedTools('claude')]).toEqual(['mcp__exa__search']);
	});
});

describe('the Claude runtime', () => {
	test('attributes an MCP tool to its server and a built-in to nothing', () => {
		expect(
			describeClaudeTools([
				'mcp__exa__web_search_exa',
				'mcp__plugin_context-mode_context-mode__ctx_search',
				'Read',
			]),
		).toEqual([
			{
				description: null,
				name: 'mcp__exa__web_search_exa',
				source: 'exa',
			},
			{
				description: null,
				name: 'mcp__plugin_context-mode_context-mode__ctx_search',
				source: 'plugin_context-mode_context-mode',
			},
			{ description: null, name: 'Read', source: null },
		]);
	});

	const trust = (tools: readonly string[]): ClaudeToolTrust => ({
		recordInventory: vi.fn(),
		recordRefusal: vi.fn(),
		trustedTools: () => toTrustedToolSet(tools, 'claude'),
	});

	const signal = new AbortController().signal;

	test('the Concierge gate clears a trusted MCP tool and notes a refusal', async () => {
		const toolTrust = trust(['mcp__exa__search']);
		const gate = createConciergeSessionGate(HOME, toolTrust);
		const ask = async (toolName: string) =>
			await gate.canUseTool(
				toolName,
				{},
				{ requestId: 'request-1', signal, toolUseID: 'call-1' },
			);

		expect(await ask('mcp__exa__search')).toMatchObject({ behavior: 'allow' });
		expect(await ask('mcp__fs__write_file')).toMatchObject({
			behavior: 'deny',
		});
		expect(toolTrust.recordRefusal).toHaveBeenCalledWith('mcp__fs__write_file');
		expect(toolTrust.recordRefusal).not.toHaveBeenCalledWith(
			'mcp__exa__search',
		);
	});

	/**
	 * Runs one tool call through the Plan Mode hook, built the way the adapter
	 * builds it from a workspace permission mode.
	 * @param input - The mode, whether the chat plans, the trusted names, and the tool.
	 * @returns The permission decision the hook rendered, or null for none.
	 */
	const planHook = async ({
		mode,
		planning,
		tool,
		trusted,
	}: {
		mode: PermissionMode;
		planning: boolean;
		tool: string;
		trusted: readonly string[];
	}): Promise<string | null> => {
		const hooks = withPlanModeHooks(
			undefined,
			() => planning,
			() => withholdsControlTools({ mode, planning }),
			() => toTrustedToolSet(trusted, 'claude'),
		);
		const hook = hooks.PreToolUse?.[0]?.hooks[0];
		if (!hook) {
			throw new Error('No PreToolUse hook registered.');
		}
		const output: HookJSONOutput = await hook(
			{
				hook_event_name: 'PreToolUse',
				tool_input: {},
				tool_name: tool,
			} as never,
			undefined,
			{ signal },
		);
		return 'hookSpecificOutput' in output &&
			output.hookSpecificOutput &&
			'permissionDecision' in output.hookSpecificOutput
			? (output.hookSpecificOutput.permissionDecision ?? null)
			: null;
	};

	test('the Plan Mode hook clears a trusted tool the CLI would withhold', async () => {
		expect(
			await planHook({
				mode: 'workspace-trusted',
				planning: true,
				tool: 'mcp__exa__search',
				trusted: ['mcp__exa__search'],
			}),
		).toBe('allow');
	});

	test('the Plan Mode hook leaves an untrusted tool to the CLI', async () => {
		expect(
			await planHook({
				mode: 'workspace-trusted',
				planning: true,
				tool: 'mcp__fs__write_file',
				trusted: ['mcp__exa__search'],
			}),
		).toBeNull();
	});

	// There the CLI routes the call to the user's own approval card, and a
	// pre-approval would spend the gate that mode exists to provide.
	test('the Plan Mode hook never pre-approves under approval-required', async () => {
		expect(
			await planHook({
				mode: 'approval-required',
				planning: true,
				tool: 'mcp__exa__search',
				trusted: ['mcp__exa__search'],
			}),
		).toBeNull();
	});

	test('the Plan Mode hook leaves a trusted tool alone outside planning', async () => {
		expect(
			await planHook({
				mode: 'workspace-trusted',
				planning: false,
				tool: 'mcp__exa__search',
				trusted: ['mcp__exa__search'],
			}),
		).toBeNull();
	});

	// `Monitor` runs a command the bash classifier never sees, so a hand-edited
	// entry for it must not become a pre-approval while planning.
	test('the Plan Mode hook never pre-approves a Claude Code built-in', async () => {
		expect(
			await planHook({
				mode: 'workspace-trusted',
				planning: true,
				tool: 'Monitor',
				trusted: ['Monitor'],
			}),
		).toBeNull();
	});
});
