import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';

import type {
	AgentControlCommand,
	AgentControlService,
} from '../../src/main/agent-control/index.ts';
import {
	type ControlServer,
	startControlServer,
} from '../../src/main/agent-control/index.ts';
import type { ControlAudience } from '../../src/shared/agent-control.ts';
import {
	HARNESS_AWARENESS,
	ORCHESTRATOR_AWARENESS,
	SUBAGENT_AWARENESS,
} from '../../src/shared/agent-control.ts';

const calls: AgentControlCommand[] = [];
let server: ControlServer | null = null;

const HARNESS_ROOT: ControlAudience = {
	hasChatTab: false,
	role: 'orchestrator',
};

/**
 * A service that answers every call the same way, so a test can vary only the
 * audience it reports and read the tool list that follows from it.
 */
const makeStubService = (
	audience: ControlAudience = HARNESS_ROOT,
): AgentControlService => ({
	describeAudience: async () => audience,
	invoke: async (command) => {
		calls.push(command);
		return { ok: true, data: { echoed: command.op, args: command.rawArgs } };
	},
	readSessionBriefNudge: async () => null,
	releaseSession: () => {},
});

const stubService: AgentControlService = makeStubService();

/** Connects an MCP client to a server serving the given audience. */
const connectAs = async (audience: ControlAudience): Promise<Client> => {
	server = await startControlServer(makeStubService(audience));
	return await connect('good');
};

/** The tool names a given audience's list carries, over a live connection. */
const toolNamesFor = async (
	audience: ControlAudience,
): Promise<readonly string[]> => {
	const client = await connectAs(audience);
	const { tools } = await client.listTools();
	await client.close();
	return tools.map((tool) => tool.name);
};

const connect = async (token: string): Promise<Client> => {
	if (!server) {
		throw new Error('server not started');
	}
	const client = new Client({ name: 'test-harness', version: '1.0.0' });
	const transport = new StreamableHTTPClientTransport(
		new URL(`${server.url}/mcp`),
		{ requestInit: { headers: { Authorization: `Bearer ${token}` } } },
	);
	await client.connect(transport);
	return client;
};

afterEach(async () => {
	calls.length = 0;
	await server?.close();
	server = null;
});

describe('agent-control MCP endpoint', () => {
	it('lists the control tools to an MCP client', async () => {
		server = await startControlServer(stubService);
		const client = await connect('good');
		const { tools } = await client.listTools();
		const names = tools.map((tool) => tool.name);
		expect(names).toContain('ensemblr_spawn_chat_tab');
		expect(names).toContain('ensemblr_launch_harness');
		expect(names).toContain('ensemblr_list_workspaces');
		expect(names).toContain('ensemblr_focus_panel');
		expect(names).toContain('ensemblr_list_models');
		expect(names).toContain('ensemblr_list_run_scripts');
		expect(names).toContain('ensemblr_wait_for_agents');
		expect(names).toContain('ensemblr_notify_orchestrator');
		expect(names).toContain('ensemblr_set_branch_name');
		expect(names).toContain('ensemblr_set_workspace_status');
		expect(names).toContain('ensemblr_get_workspace_status');
		// The review ops act on the workspace's git worktree and its comment
		// store, both of which a harness caller owns, so all four are served.
		expect(names).toContain('ensemblr_get_workspace_diff');
		expect(names).toContain('ensemblr_get_diff_comments');
		expect(names).toContain('ensemblr_add_diff_comments');
		expect(names).toContain('ensemblr_resolve_diff_comments');
		// Auditing a delegated conversation is a read over persisted events, so it
		// is served to every origin that may read a report at all.
		expect(names).toContain('ensemblr_read_conversation');
		// Chat-tab ops a harness origin cannot use: its tab is a terminal titled
		// from the harness's own session log, and the service refuses all four to a
		// caller with no chat tab.
		expect(names).not.toContain('ensemblr_set_name');
		expect(names).not.toContain('ensemblr_set_summary');
		expect(names).not.toContain('ensemblr_ask_user_question');
		expect(names).not.toContain('ensemblr_exit_plan_mode');
		expect(tools).toHaveLength(30);
		await client.close();
	});

	// Stat mode is the whole mitigation for a diff with no natural size ceiling,
	// so the description a harness reads has to lead with it.
	it('tells a harness to probe the diff size before reading it', async () => {
		server = await startControlServer(stubService);
		const client = await connect('good');
		const { tools } = await client.listTools();
		const diffTool = tools.find(
			(tool) => tool.name === 'ensemblr_get_workspace_diff',
		);
		expect(diffTool?.description).toContain('stat=true FIRST');
		expect(diffTool?.description).toContain('omittedFiles');
		await client.close();
	});

	// Omitting scriptName runs whichever script the repository marks default, so a
	// harness that never learns the parameter exists silently starts the wrong one.
	it('offers a run script by name and points at the list tool first', async () => {
		server = await startControlServer(stubService);
		const client = await connect('good');
		const { tools } = await client.listTools();
		const startTool = tools.find(
			(tool) => tool.name === 'ensemblr_start_terminal',
		);
		expect(startTool?.description).toContain('ensemblr_list_run_scripts');
		expect(startTool?.inputSchema.properties).toHaveProperty('scriptName');
		await client.close();
	});

	it('forwards the run script name a harness asked for', async () => {
		server = await startControlServer(stubService);
		const client = await connect('secret-token');
		await client.callTool({
			name: 'ensemblr_start_terminal',
			arguments: { kind: 'run', scriptName: 'playground' },
		});
		expect(calls).toEqual([
			{
				op: 'startTerminal',
				token: 'secret-token',
				rawArgs: { kind: 'run', scriptName: 'playground' },
			},
		]);
		await client.close();
	});

	it('serves the harness playbook as the MCP server instructions', async () => {
		server = await startControlServer(stubService);
		const client = await connect('good');
		const instructions = client.getInstructions() ?? '';
		expect(instructions).toBe(HARNESS_AWARENESS);
		expect(instructions).toContain('Ensemblr');
		expect(instructions).toContain('ensemblr_get_conversation_status');
		await client.close();
	});

	// A playbook that names a tool the endpoint does not serve sends the model
	// hunting for it, which is exactly what dropping `ensemblr_set_name` was for.
	it('names only tools the endpoint actually serves', async () => {
		server = await startControlServer(stubService);
		const client = await connect('good');
		const { tools } = await client.listTools();
		const served = new Set(tools.map((tool) => tool.name));
		const mentioned = new Set(
			HARNESS_AWARENESS.match(/ensemblr_[a-z_]+/g) ?? [],
		);
		expect(mentioned.size).toBeGreaterThan(0);
		expect([...mentioned].filter((name) => !served.has(name))).toEqual([]);
		await client.close();
	});

	it('rejects an MCP connection with no bearer token', async () => {
		server = await startControlServer(stubService);
		const client = new Client({ name: 'test-harness', version: '1.0.0' });
		const transport = new StreamableHTTPClientTransport(
			new URL(`${server.url}/mcp`),
		);
		await expect(client.connect(transport)).rejects.toThrow();
		expect(calls).toHaveLength(0);
	});

	it('forwards a tool call to the service with the bearer token', async () => {
		server = await startControlServer(stubService);
		const client = await connect('secret-token');
		const result = await client.callTool({
			name: 'ensemblr_start_terminal',
			arguments: { kind: 'run' },
		});
		expect(calls).toEqual([
			{
				op: 'startTerminal',
				token: 'secret-token',
				rawArgs: { kind: 'run' },
			},
		]);
		const content = result.content as Array<{ type: string; text: string }>;
		expect(content[0]?.text).toContain('startTerminal');
		await client.close();
	});
});

// A first-class runtime reaches the app through the same endpoint a harness does,
// but it drives a real chat tab, so the list and the playbook it receives have to
// follow the caller rather than the transport.
describe('agent-control MCP endpoint, per-origin surface', () => {
	const CHAT_TAB_TOOLS = [
		'ensemblr_set_name',
		'ensemblr_set_summary',
		'ensemblr_ask_user_question',
		'ensemblr_exit_plan_mode',
	] as const;

	it('serves the chat-tab tools to a first-class root', async () => {
		const names = await toolNamesFor({
			hasChatTab: true,
			role: 'orchestrator',
		});

		for (const tool of CHAT_TAB_TOOLS) {
			expect(names, tool).toContain(tool);
		}
		expect(names).toContain('ensemblr_start_conversation');
		expect(names).toContain('ensemblr_wait_for_agents');
	});

	it('withholds the chat-tab tools from a harness root', async () => {
		const names = await toolNamesFor(HARNESS_ROOT);

		for (const tool of CHAT_TAB_TOOLS) {
			expect(names, tool).not.toContain(tool);
		}
	});

	// The sub-agent axis is the one the Pi extension already applies to its own
	// registrations; a first-class child over MCP has to land in the same place, or
	// its list advertises a delegation surface the service refuses it.
	it('withholds the delegation surface from a first-class sub-agent', async () => {
		const names = await toolNamesFor({ hasChatTab: true, role: 'subagent' });

		expect(names).toContain('ensemblr_set_name');
		expect(names).toContain('ensemblr_set_summary');
		expect(names).toContain('ensemblr_notify_orchestrator');
		expect(names).toContain('ensemblr_get_workspace_diff');
		for (const tool of [
			'ensemblr_start_conversation',
			'ensemblr_spawn_chat_tab',
			'ensemblr_launch_harness',
			'ensemblr_ask_user_question',
			'ensemblr_exit_plan_mode',
			'ensemblr_set_branch_name',
			'ensemblr_wait_for_agents',
		]) {
			expect(names, tool).not.toContain(tool);
		}
	});

	it('serves the orchestrator playbook to a first-class root', async () => {
		const client = await connectAs({ hasChatTab: true, role: 'orchestrator' });

		expect(client.getInstructions()).toBe(ORCHESTRATOR_AWARENESS);

		await client.close();
	});

	it('serves the sub-agent playbook to a first-class sub-agent', async () => {
		const client = await connectAs({ hasChatTab: true, role: 'subagent' });

		expect(client.getInstructions()).toBe(SUBAGENT_AWARENESS);

		await client.close();
	});

	// The harness variant tells its reader that naming a tab, summarizing, asking
	// the user, and Plan Mode are absent by design. Serving it to a caller whose
	// list carries all four would contradict the list in the same prompt.
	it('keeps the harness playbook for a caller with no chat tab', async () => {
		const client = await connectAs(HARNESS_ROOT);

		expect(client.getInstructions()).toBe(HARNESS_AWARENESS);

		await client.close();
	});

	it('names only tools a first-class root is actually served', async () => {
		const served = new Set(
			await toolNamesFor({ hasChatTab: true, role: 'orchestrator' }),
		);
		const mentioned = new Set(
			ORCHESTRATOR_AWARENESS.match(/ensemblr_[a-z_]+/g) ?? [],
		);

		expect(mentioned.size).toBeGreaterThan(0);
		expect([...mentioned].filter((name) => !served.has(name))).toEqual([]);
	});
});
