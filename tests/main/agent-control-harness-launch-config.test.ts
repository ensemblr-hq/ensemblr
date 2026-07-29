import { describe, expect, it } from 'vitest';

import {
	buildHarnessLaunchDecoration,
	decorateHarnessCommand,
	type HarnessLaunchContext,
} from '../../src/main/agent-control/index.ts';

const URL = 'http://127.0.0.1:53219';
const INSTRUCTIONS = '/tmp/ensemblr/harness-instructions';

const context = (
	overrides: Partial<HarnessLaunchContext> = {},
): HarnessLaunchContext => ({
	baseUrl: URL,
	harnessId: 'claude',
	instructionsDirectory: INSTRUCTIONS,
	token: 'tok',
	...overrides,
});

describe('buildHarnessLaunchDecoration', () => {
	it('builds a Claude Code --mcp-config referencing the token env var, never the secret', () => {
		const joined = buildHarnessLaunchDecoration('claude', URL).flags.join(' ');
		expect(joined).toContain('--mcp-config');
		expect(joined).toContain(`${URL}/mcp`);
		expect(joined).toContain('"type":"http"');
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the literal ${ENSEMBLR_CONTROL_TOKEN} is the exact text Claude Code expands from env — it must not be interpolated here.
		expect(joined).toContain('Bearer ${ENSEMBLR_CONTROL_TOKEN}');
	});

	it('appends the playbook to Claude Code’s system prompt', () => {
		const joined = buildHarnessLaunchDecoration(
			'claude',
			URL,
			INSTRUCTIONS,
		).flags.join(' ');
		expect(joined).toContain(
			`--append-system-prompt-file '${INSTRUCTIONS}/AGENTS.md'`,
		);
	});

	it('builds Codex -c overrides using the token env var', () => {
		const joined = buildHarnessLaunchDecoration(
			'codex',
			URL,
			INSTRUCTIONS,
		).flags.join(' ');
		expect(joined).toContain(`mcp_servers.ensemblr.url="${URL}/mcp"`);
		expect(joined).toContain(
			'mcp_servers.ensemblr.bearer_token_env_var="ENSEMBLR_CONTROL_TOKEN"',
		);
	});

	// Codex replaces rather than appends its instructions, and its only additive
	// channel is an AGENTS.md inside the user's own repository. It reads the MCP
	// server's `instructions` field instead.
	it('passes Codex no instructions flag, since it has no additive one', () => {
		const { env, flags } = buildHarnessLaunchDecoration(
			'codex',
			URL,
			INSTRUCTIONS,
		);
		expect(env).toEqual([]);
		expect(flags.join(' ')).not.toContain(INSTRUCTIONS);
	});

	it('configures Vibe through VIBE_MCP_SERVERS, which is its only per-launch channel', () => {
		const joined = buildHarnessLaunchDecoration(
			'vibe',
			URL,
			INSTRUCTIONS,
		).env.join(' ');
		expect(joined).toContain('VIBE_MCP_SERVERS=');
		expect(joined).toContain('"transport":"streamable-http"');
		expect(joined).toContain(`"url":"${URL}/mcp"`);
		expect(joined).toContain('"api_key_env":"ENSEMBLR_CONTROL_TOKEN"');
	});

	it('points Vibe at the playbook directory it loads AGENTS.md from', () => {
		const { flags } = buildHarnessLaunchDecoration('vibe', URL, INSTRUCTIONS);
		expect(flags.join(' ')).toBe(`--add-dir '${INSTRUCTIONS}'`);
	});

	it('names the token env var but never a token value, for every harness', () => {
		for (const harnessId of ['claude', 'codex', 'vibe']) {
			const { env, flags } = buildHarnessLaunchDecoration(
				harnessId,
				URL,
				INSTRUCTIONS,
			);
			expect([...env, ...flags].join(' ')).toContain('ENSEMBLR_CONTROL_TOKEN');
		}
	});

	it('returns nothing for an unknown harness', () => {
		expect(buildHarnessLaunchDecoration('mystery', URL)).toEqual({
			env: [],
			flags: [],
		});
	});
});

describe('decorateHarnessCommand', () => {
	it('appends flags after the registry-built command', () => {
		const out = decorateHarnessCommand('claude --skip', context());
		expect(out.startsWith('claude --skip ')).toBe(true);
		expect(out).toContain('--mcp-config');
	});

	it('prefixes Vibe’s env assignment before the command', () => {
		const out = decorateHarnessCommand(
			'vibe --agent auto-approve --trust',
			context({ harnessId: 'vibe' }),
		);
		expect(out.startsWith('VIBE_MCP_SERVERS=')).toBe(true);
		expect(out).toContain(' vibe --agent auto-approve --trust ');
	});

	it('leaves the command untouched when the server is down', () => {
		expect(decorateHarnessCommand('claude', context({ baseUrl: null }))).toBe(
			'claude',
		);
		expect(decorateHarnessCommand('claude', context({ token: null }))).toBe(
			'claude',
		);
	});

	it('leaves the command untouched for an unsupported harness', () => {
		expect(
			decorateHarnessCommand('mystery', context({ harnessId: 'mystery' })),
		).toBe('mystery');
	});

	it('still configures MCP when the playbook could not be written', () => {
		const out = decorateHarnessCommand(
			'claude',
			context({ instructionsDirectory: null }),
		);
		expect(out).toContain('--mcp-config');
		expect(out).not.toContain('--append-system-prompt-file');
	});
});
