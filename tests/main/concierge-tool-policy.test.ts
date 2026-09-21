import type {
	PermissionResult,
	SyncHookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, test } from 'vitest';

import { TOOL_DEFS } from '../../src/main/agent-control/index.ts';
import { createConciergeSessionGate } from '../../src/main/claude-agent/claude-concierge-guard.ts';
import {
	CONCIERGE_ONLY_OPS,
	CONCIERGE_WITHHELD_OPS,
	conciergeControlOpDenial,
	isEnsemblrControlTool,
	withheldControlOps,
} from '../../src/shared/agent-control.ts';
import {
	CONCIERGE_GUARDED_TOOLS,
	CONCIERGE_WRITE_TOOLS,
	evaluateConciergeTool,
	pathStaysInConciergeHome,
} from '../../src/shared/plan-mode.ts';
import { controlOpForToolName } from './support/pi-extension-source.ts';

const HOME = '/root/concierge';

const verdict = (
	tool: string,
	extra: { command?: string; path?: string } = {},
) => evaluateConciergeTool({ conciergeHome: HOME, tool, ...extra });

// Every case here failed open before: `~` and `$` matched neither absolute-path
// pattern, so they were walked as relative against the home and admitted, and an
// empty home made the suffix check vacuously true. The empty home is reachable —
// the migration that added the column backfilled it that way for every existing
// row.
describe('the paths the containment rule must fail closed on', () => {
	test.each([
		['a tilde home expansion', '~/.ssh/authorized_keys'],
		['a tilde naming another user', '~root/x'],
		['a bare tilde segment', '~'],
		['an environment variable', '$HOME/x.md'],
		['a variable mid-path', 'memory/$USER/notes.md'],
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the literal text a shell would expand is the fixture; interpolating it would test nothing.
		['a braced variable', '${HOME}/x.md'],
	])('refuses %s', (_label, candidate) => {
		expect(pathStaysInConciergeHome(HOME, candidate)).toBe(false);
		expect(verdict('write', { path: candidate }).blocked).toBe(true);
	});

	test.each([
		['an absolute path', '/etc/passwd'],
		['a relative path', 'memory/a-fact.md'],
		['the empty string', ''],
	])(
		'admits nothing at all when the home is unset, not even %s',
		(_label, candidate) => {
			expect(pathStaysInConciergeHome('', candidate)).toBe(false);
		},
	);

	// Left off, a mutating built-in is never forwarded and never classified, so
	// the policy it would have failed is one nothing ever applies.
	test('classifies every mutating built-in both runtimes ship', () => {
		for (const tool of ['MultiEdit', 'NotebookEdit']) {
			expect(CONCIERGE_WRITE_TOOLS.has(tool)).toBe(true);
			expect(CONCIERGE_GUARDED_TOOLS.has(tool)).toBe(true);
		}
	});
});

describe('the containment rule behind every Concierge file write', () => {
	test.each([
		['the home itself', '/root/concierge'],
		['a file directly inside', '/root/concierge/MEMORY.md'],
		['a nested file', '/root/concierge/memory/a-fact.md'],
		['a relative path', 'artifacts/report.md'],
		['a relative path that climbs and returns', 'memory/../artifacts/x.md'],
		['a redundant current-directory segment', './memory/./a.md'],
		['a Windows-style separator inside the home', 'memory\\a.md'],
	])('admits %s', (_label, candidate) => {
		expect(pathStaysInConciergeHome(HOME, candidate)).toBe(true);
	});

	test.each([
		['an empty path', ''],
		['a null byte', 'memory/a\0.md'],
		['a workspace file', '/root/workspaces/bruckner/src/main.ts'],
		['an absolute climb out', '/root/concierge/../workspaces/a/file.ts'],
		['a relative climb out', '../workspaces/a/file.ts'],
		['a deep relative climb', 'memory/../../repos/ensemblr/README.md'],
		['a climb past the filesystem root', '../../../../../../etc/passwd'],
		['a sibling sharing the prefix', '/root/concierge-notes/leak.md'],
		['a Windows-style climb out', 'memory\\..\\..\\repos\\x.md'],
		['a Windows drive path', 'C:\\Users\\alice\\notes.md'],
	])('refuses %s', (_label, candidate) => {
		expect(pathStaysInConciergeHome(HOME, candidate)).toBe(false);
	});
});

describe('the Concierge tool policy', () => {
	test('admits a write inside its own home', () => {
		expect(verdict('write', { path: 'memory/a-fact.md' }).blocked).toBe(false);
		expect(
			verdict('Write', { path: `${HOME}/artifacts/report.md` }).blocked,
		).toBe(false);
	});

	test('refuses a write into a workspace, naming what to do instead', () => {
		const result = verdict('edit', {
			path: '/root/workspaces/bruckner/src/main.ts',
		});

		expect(result.blocked).toBe(true);
		expect(result.reason).toContain('outside your own folder');
		expect(result.reason).toContain('ensemblr_start_conversation');
	});

	test('refuses a write it cannot check', () => {
		expect(verdict('write').blocked).toBe(true);
	});

	test('guards both runtimes’ spellings of the same tool', () => {
		for (const tool of ['write', 'Write', 'edit', 'Edit', 'NotebookEdit']) {
			expect(CONCIERGE_GUARDED_TOOLS.has(tool)).toBe(true);
			expect(verdict(tool, { path: '/etc/passwd' }).blocked).toBe(true);
		}
	});

	test('restricts bash to read-only commands', () => {
		expect(verdict('bash', { command: 'git status' }).blocked).toBe(false);
		expect(verdict('Bash', { command: 'ls -la' }).blocked).toBe(false);
		expect(
			verdict('bash', { command: 'rm -rf /root/workspaces' }).blocked,
		).toBe(true);
		expect(
			verdict('bash', { command: 'echo hi > /root/workspaces/a/file' }).blocked,
		).toBe(true);
	});

	// The Concierge reads across every workspace at once, so a command that
	// classifies on its head word while its payload hides in an assignment or an
	// attached flag value is the one bypass here whose blast radius leaves the
	// repository it came from.
	test.each([
		['an environment assignment git resolves to a program', 'bash'],
		['the same command however the runtime spells the tool', 'Bash'],
	])('refuses %s', (_label, tool) => {
		expect(
			verdict(tool, {
				command: `GIT_EXTERNAL_DIFF='sh -c "id"' git diff HEAD~1`,
			}).blocked,
		).toBe(true);
	});

	test.each([
		['a variable that only looks harmless', 'FOO=bar ls'],
		['a redirected binary', 'PATH=./tools ls'],
		['a second positional that is an output file', 'uniq a.txt /root/.bashrc'],
		['an output flag clustered with another', 'sort -no /root/.bashrc a.txt'],
		['an output flag carrying an attached value', 'sort -o/root/.bashrc a.txt'],
		[
			'an output flag truncated to an abbreviation',
			'sort --out=/root/.bashrc a.txt',
		],
	])('refuses %s', (_label, command) => {
		expect(verdict('bash', { command }).blocked).toBe(true);
	});

	// The Concierge is read-only outside its own folder for its whole life, not
	// for one planning turn, so a guard that over-blocks costs it the commands
	// it supervises with.
	test.each([
		['the untracked-files mode', 'git status -uno'],
		['a pickaxe search', 'git log -Sneedle'],
		['a ref listing sorted by date', 'git for-each-ref --sort -committerdate'],
	])('still allows %s', (_label, command) => {
		expect(verdict('bash', { command }).blocked).toBe(false);
	});

	test('leaves the read-only built-ins of both runtimes untouched', () => {
		for (const tool of ['read', 'Read', 'grep', 'Grep', 'Glob', 'WebFetch']) {
			expect(verdict(tool).blocked, tool).toBe(false);
		}
	});
});

describe('the Concierge withholding axis', () => {
	test('withholds every write channel into a workspace', () => {
		for (const op of [
			'launchHarness',
			'startTerminal',
			'stopTerminal',
			'writeTerminal',
			'setBranchName',
		] as const) {
			expect(CONCIERGE_WITHHELD_OPS.has(op)).toBe(true);
			expect(conciergeControlOpDenial(op)).not.toBeNull();
		}
	});

	// The Concierge is a panel rather than a chat tab, so both ops act on a row it
	// has never had. `originHasChatTab` cannot refuse them — it reads the caller's
	// species, and a Concierge runs on the same runtimes a chat tab does — so
	// without these entries the calls reach the services and come back as
	// `not-found` and `internal`, which read to a model as faults worth retrying.
	test('withholds the chat-tab bookkeeping it has no tab for', () => {
		for (const op of ['setName', 'setSummary'] as const) {
			expect(CONCIERGE_WITHHELD_OPS.has(op)).toBe(true);
			expect(conciergeControlOpDenial(op)).not.toBeNull();
		}
	});

	// A denial that points at a tool the Concierge also lacks sends it round the
	// same refusal, which is the failure every reason here is written to avoid.
	test('never redirects a denied Concierge to a tool it also lacks', () => {
		for (const op of CONCIERGE_WITHHELD_OPS) {
			const denial = conciergeControlOpDenial(op) ?? '';
			for (const [, named] of denial.matchAll(/`(ensemblr_[a-z_]+)`/g)) {
				expect(
					CONCIERGE_WITHHELD_OPS.has(controlOpForToolName(named)),
					`\`${op}\` redirects to \`${named}\`, which is also withheld`,
				).toBe(false);
			}
		}
	});

	test('keeps the ops that make supervision possible', () => {
		for (const op of [
			'startConversation',
			'sendFollowUp',
			'waitForAgents',
			'readConversation',
			'getWorkspaceDiff',
			'addDiffComments',
			'setWorkspaceStatus',
			'linearUpdateIssue',
			'askUserQuestion',
			'createWorkspace',
			'focusWorkspace',
			'recallMemory',
		] as const) {
			expect(CONCIERGE_WITHHELD_OPS.has(op)).toBe(false);
			expect(conciergeControlOpDenial(op)).toBeNull();
		}
	});

	test('answers on its own rather than through the lineage axes', () => {
		// A Concierge is neither a root that delegates nor a child that was
		// delegated to, so folding it into those axes would mean answering "is it a
		// sub-agent?" about something that can never be one.
		expect(
			withheldControlOps({
				architectureDiagram: true,
				tuiHarnesses: true,
				delegation: 'native',
				hasChatTab: false,
				role: 'concierge',
			}),
		).toStrictEqual(CONCIERGE_WITHHELD_OPS);
	});

	test('withholds the Concierge-only ops from every workspace agent', () => {
		for (const role of ['orchestrator', 'subagent'] as const) {
			const withheld = withheldControlOps({
				architectureDiagram: true,
				tuiHarnesses: true,
				delegation: 'ensemblr',
				hasChatTab: true,
				role,
			});
			for (const op of CONCIERGE_ONLY_OPS) {
				expect(withheld.has(op)).toBe(true);
			}
		}
	});
});

describe('the Claude runtime’s Concierge gate', () => {
	const gate = createConciergeSessionGate(HOME);
	const signal = new AbortController().signal;

	const ask = async (
		toolName: string,
		input: Record<string, unknown>,
	): Promise<PermissionResult> => {
		const result = await gate.canUseTool(toolName, input, {
			requestId: 'request-1',
			signal,
			toolUseID: 'call-1',
		});
		if (!result) {
			throw new Error(`the gate returned no verdict for \`${toolName}\``);
		}
		return result;
	};

	const hook = async (
		toolName: string,
		input: Record<string, unknown>,
	): Promise<SyncHookJSONOutput> => {
		const callback = gate.hooks.PreToolUse?.[0]?.hooks[0];
		if (!callback) {
			throw new Error('the gate registered no PreToolUse hook');
		}
		const result = await callback(
			{
				cwd: HOME,
				hook_event_name: 'PreToolUse',
				session_id: 'concierge-1',
				tool_input: input,
				tool_name: toolName,
				tool_use_id: 'call-1',
				transcript_path: `${HOME}/transcript.jsonl`,
			},
			'call-1',
			{ signal },
		);
		if ('async' in result) {
			throw new Error('the gate deferred its decision');
		}
		return result;
	};

	// `bypassPermissions` skips `canUseTool` outright, so a Concierge opened on
	// the trusted mapping would run with no gate at all — which is how it could
	// edit any file in any workspace.
	test('opens on a mode that actually consults the gate', () => {
		expect(gate.permission.permissionMode).toBe('default');
		expect(gate.permission.allowDangerouslySkipPermissions).toBeUndefined();
	});

	test('refuses a write outside the home, naming what to do instead', async () => {
		const result = await ask('Write', {
			content: 'leak',
			file_path: '/root/workspaces/bruckner/src/main.ts',
		});

		expect(result.behavior).toBe('deny');
		if (result.behavior === 'deny') {
			expect(result.message).toContain('outside your own folder');
			expect(result.message).toContain('ensemblr_start_conversation');
		}
	});

	test('admits a write inside the home', async () => {
		const result = await ask('Write', {
			content: '# a fact',
			file_path: `${HOME}/memory/a-fact.md`,
		});

		expect(result.behavior).toBe('allow');
	});

	// Claude names the field `file_path` where Pi says `path`; reading only one
	// spelling reaches the classifier as "no path", which refuses every write
	// including the ones inside the home.
	test('reads Claude’s own spelling of the target path', async () => {
		expect(
			(await ask('Edit', { file_path: `${HOME}/artifacts/x.md` })).behavior,
		).toBe('allow');
		expect(
			(await ask('NotebookEdit', { notebook_path: '/root/repos/a/x.ipynb' }))
				.behavior,
		).toBe('deny');
	});

	test('restricts Bash to read-only commands', async () => {
		expect((await ask('Bash', { command: 'git status' })).behavior).toBe(
			'allow',
		);
		expect(
			(await ask('Bash', { command: 'rm -rf /root/workspaces' })).behavior,
		).toBe('deny');
	});

	test('leaves every known read-only tool untouched', async () => {
		for (const tool of ['Read', 'Grep', 'WebFetch']) {
			expect((await ask(tool, {})).behavior).toBe('allow');
		}
	});

	test('denies a tool it cannot vouch for', async () => {
		expect(
			(await ask('mcp__fs__write_file', { path: '/etc/hosts' })).behavior,
		).toBe('deny');
	});

	// The hook resolves before permissions are consulted at all, so it still
	// holds when an allow-rule in the user’s own settings would have
	// pre-approved the write and skipped `canUseTool`.
	test('backs the gate with a PreToolUse hook that denies the same write', async () => {
		const denied = await hook('Write', {
			file_path: '/root/workspaces/bruckner/src/main.ts',
		});
		const allowed = await hook('Write', { file_path: `${HOME}/MEMORY.md` });

		expect(denied.hookSpecificOutput).toMatchObject({
			hookEventName: 'PreToolUse',
			permissionDecision: 'deny',
		});
		expect(allowed.hookSpecificOutput).toBeUndefined();
	});
});

// The classifier used to return `{ blocked: false }` for every name it did not
// recognize. Wave 1 made the Pi extension forward by default rather than
// intercepting eight literal names, so those calls now arrive here — `powershell`
// runs a shell the bash classifier cannot read, and an MCP server's write tool
// writes anywhere on disk. Both were cleared.
describe('the Concierge guard denies a tool it cannot vouch for', () => {
	test.each([
		['powershell', {}],
		['mcp__fs__write_file', { path: '/etc/hosts' }],
		['mcp__github__create_pull_request', {}],
		['ShellCommand', { command: 'ls' }],
		['', {}],
	])('blocks %s', (tool, extra) => {
		const result = verdict(tool, extra);
		expect(result.blocked).toBe(true);
		expect(result.reason).toContain('refused rather than guessed at');
	});

	// The reads are what a supervising agent does all day, so a deny-by-default
	// posture that took them would be a worse bug than the one it closes. Both
	// runtimes' spellings, because one classifier answers for both.
	test.each([
		'find',
		'grep',
		'ls',
		'read',
		'Glob',
		'Grep',
		'Read',
		'NotebookRead',
		'Task',
		'TodoWrite',
		'WebFetch',
		'WebSearch',
		'BashOutput',
		'Skill',
		'SlashCommand',
		'AskUserQuestion',
		'ExitPlanMode',
	])('clears the read-only built-in %s', (tool) => {
		expect(verdict(tool)).toEqual({ blocked: false });
	});

	// Pi has no web tool of its own; `pi-web-access` supplies it. Refusing these
	// left a Pi Concierge unable to answer "is there a build for X?" while a
	// Claude Concierge answered it with `WebSearch`.
	test.each([
		'web_search',
		'fetch_content',
		'get_search_content',
		'source_check',
	])('clears the web-access tool %s', (tool) => {
		expect(verdict(tool)).toEqual({ blocked: false });
	});

	// Claude Code renamed six built-ins, and which name arrives depends on which
	// `claude` binary is on PATH. Listing one spelling of a pair left a Concierge
	// on a current binary refused its own delegation tool.
	test.each([
		['Task', 'Agent'],
		['KillShell', 'TaskStop'],
		['BashOutput', 'TaskOutput'],
		['ListPeers', 'ListAgents'],
		['ListMcpResources', 'ListMcpResourcesTool'],
		['ReadMcpResource', 'ReadMcpResourceTool'],
	])('clears %s under both its spellings, including %s', (before, after) => {
		expect(verdict(before)).toEqual({ blocked: false });
		expect(verdict(after)).toEqual({ blocked: false });
	});

	// Gated per op and per role by the control server instead, and a blanket
	// denial here would take away the supervision the Concierge exists for.
	test.each([
		'ensemblr_start_conversation',
		'ensemblr_list_workspaces',
		'ensemblr_update_app_settings',
	])('clears the control tool %s', (tool) => {
		expect(verdict(tool)).toEqual({ blocked: false });
	});

	// A Concierge on Claude Code reaches the control server over MCP, where the
	// SDK namespaces every tool by its server. The prefix test that stood here
	// saw none of them, so a Claude Concierge was refused its own tools — the
	// whole supervision surface — and told to hold a tool it also could not call.
	test.each([
		'mcp__ensemblr__ensemblr_list_workspaces',
		'mcp__ensemblr__ensemblr_list_models',
		'mcp__ensemblr__ensemblr_create_workspace',
		'mcp__ensemblr__ensemblr_start_conversation',
		'ensemblr__ensemblr_list_workspaces',
		'ensemblr.ensemblr_list_workspaces',
	])('clears the namespaced control tool %s', (tool) => {
		expect(verdict(tool)).toEqual({ blocked: false });
	});

	// Membership rather than a prefix is what keeps that widening honest: another
	// server's tool cannot borrow the clearance by carrying the prefix, and a
	// control tool name cannot borrow it from a server that is not ours.
	//
	// The last two are why the wrapper is matched entire rather than by its final
	// segment: an MCP server may carry the separator in its own name, so a name
	// ending in an `ensemblr` segment is not the same claim as being served by
	// the control server.
	test.each([
		'mcp__fs__ensemblr_write_file',
		'mcp__fs__ensemblr_list_workspaces',
		'ensemblr_delete_everything',
		'mcp__fs__ensemblr__ensemblr_start_terminal',
		'fs.ensemblr.ensemblr_write_terminal',
	])('still blocks %s', (tool) => {
		const result = verdict(tool);
		expect(result.blocked).toBe(true);
		expect(result.reason).toContain('refused rather than guessed at');
	});

	test('covers every control tool the MCP endpoint serves', () => {
		for (const { name } of TOOL_DEFS) {
			expect(isEnsemblrControlTool(name)).toBe(true);
			expect(isEnsemblrControlTool(`mcp__ensemblr__${name}`)).toBe(true);
			expect(verdict(`mcp__ensemblr__${name}`)).toEqual({ blocked: false });
		}
	});

	// The write and shell policies still answer first, with their own reasons.
	test('keeps the write and shell verdicts ahead of the default', () => {
		expect(verdict('write', { path: `${HOME}/notes.md` })).toEqual({
			blocked: false,
		});
		expect(verdict('write', { path: '/etc/hosts' }).reason).toContain(
			'outside your own folder',
		);
		expect(verdict('bash', { command: 'ls -la' })).toEqual({ blocked: false });
		expect(verdict('bash', { command: 'rm -rf /' }).reason).toContain(
			'not read-only',
		);
	});
});
