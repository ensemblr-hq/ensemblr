import { describe, expect, it } from 'vitest';

import {
	appendHarnessMcpConfig,
	buildHarnessMcpArgs,
} from '../../src/main/agent-control/index.ts';

const URL = 'http://127.0.0.1:53219';

describe('buildHarnessMcpArgs', () => {
	it('builds a Claude Code --mcp-config referencing the token env var, never the secret', () => {
		const args = buildHarnessMcpArgs('claude', URL);
		expect(args).toContain('--mcp-config');
		expect(args).toContain(`${URL}/mcp`);
		expect(args).toContain('"type":"http"');
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the literal ${ENSEMBLR_CONTROL_TOKEN} is the exact text Claude Code expands from env — it must not be interpolated here.
		expect(args).toContain('Bearer ${ENSEMBLR_CONTROL_TOKEN}');
	});

	it('builds Codex -c overrides using the token env var', () => {
		const args = buildHarnessMcpArgs('codex', URL);
		expect(args).toContain(`mcp_servers.ensemblr.url="${URL}/mcp"`);
		expect(args).toContain(
			'mcp_servers.ensemblr.bearer_token_env_var="ENSEMBLR_CONTROL_TOKEN"',
		);
	});

	it('returns nothing for a harness with no known HTTP-MCP config', () => {
		expect(buildHarnessMcpArgs('vibe', URL)).toBe('');
	});
});

describe('appendHarnessMcpConfig', () => {
	it('appends flags to the command for a supported harness', () => {
		const out = appendHarnessMcpConfig('claude --skip', 'claude', URL, 'tok');
		expect(out.startsWith('claude --skip ')).toBe(true);
		expect(out).toContain('--mcp-config');
	});

	it('leaves the command untouched when the server is down', () => {
		expect(appendHarnessMcpConfig('claude', 'claude', null, 'tok')).toBe(
			'claude',
		);
		expect(appendHarnessMcpConfig('claude', 'claude', URL, null)).toBe(
			'claude',
		);
	});

	it('leaves the command untouched for an unsupported harness', () => {
		expect(appendHarnessMcpConfig('vibe', 'vibe', URL, 'tok')).toBe('vibe');
	});
});
