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
import { HARNESS_AWARENESS } from '../../src/shared/agent-control.ts';

const calls: AgentControlCommand[] = [];
let server: ControlServer | null = null;

const stubService: AgentControlService = {
	invoke: async (command) => {
		calls.push(command);
		return { ok: true, data: { echoed: command.op, args: command.rawArgs } };
	},
	releaseSession: () => {},
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
		expect(names).toContain('ensemblr_wait_for_agents');
		expect(names).toContain('ensemblr_notify_orchestrator');
		expect(names).toContain('ensemblr_set_branch_name');
		expect(names).toContain('ensemblr_set_workspace_status');
		expect(names).toContain('ensemblr_get_workspace_status');
		// The review ops act on the workspace's git worktree and its comment
		// store, both of which a harness caller owns, so all three are served.
		expect(names).toContain('ensemblr_get_workspace_diff');
		expect(names).toContain('ensemblr_get_diff_comments');
		expect(names).toContain('ensemblr_add_diff_comments');
		// Chat-tab ops a harness origin cannot use: its tab is a terminal titled
		// from the harness's own session log, and the service gates the rest to Pi.
		expect(names).not.toContain('ensemblr_set_name');
		expect(names).not.toContain('ensemblr_set_summary');
		expect(names).not.toContain('ensemblr_ask_user_question');
		expect(names).not.toContain('ensemblr_exit_plan_mode');
		expect(tools).toHaveLength(27);
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
