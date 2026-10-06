import { describe, expect, it, vi } from 'vitest';

import {
	type AgentControlPorts,
	createAgentControlService,
	createGuardrails,
	createOriginRegistry,
	TOOL_DEFS,
} from '../../src/main/agent-control/index.ts';
import type { SecretValuesPort } from '../../src/main/agent-control/ports.ts';
import {
	MOD_CONTROL_LIMITS,
	type WorkspaceLinkedIssue,
} from '../../src/shared/agent-control.ts';
import type { PermissionMode } from '../../src/shared/permissions.ts';

const A_SECRET = 'alpha-secret-value';
const B_SECRET = 'bravo-secret-value';

const SECRETS_BY_WORKSPACE: Record<string, { name: string; value: string }[]> =
	{
		'ws-a': [{ name: 'API_KEY', value: A_SECRET }],
		'ws-b': [{ name: 'B_KEY', value: B_SECRET }],
	};

const LINKED_ISSUE: WorkspaceLinkedIssue = {
	accountId: 'acct-1',
	identifier: 'ENG-7',
	provider: 'linear',
	title: 'Ship the mods',
	url: 'https://linear.app/x/issue/ENG-7',
};

interface SetupOptions {
	afk?: boolean;
	getIssue?: ReturnType<typeof vi.fn>;
	leaf?: boolean;
	linkedIssue?: WorkspaceLinkedIssue | null;
	permissionMode?: PermissionMode;
	planning?: boolean;
	secretValues?: SecretValuesPort | null;
}

const makePorts = (options: SetupOptions): AgentControlPorts =>
	({
		afkMode: {
			activateForSpawn: vi.fn(),
			isActive: vi.fn(() => options.afk ?? false),
			releaseSession: vi.fn(),
		},
		confirm: { confirm: vi.fn().mockResolvedValue(false) },
		conversations: {
			isSpawnedSubAgent: vi.fn().mockResolvedValue(options.leaf ?? false),
		},
		linear: {
			getIssue: options.getIssue ?? vi.fn(),
			readLinkedIssue: vi.fn(() => options.linkedIssue ?? null),
		},
		permissions: {
			getMode: () => options.permissionMode ?? 'workspace-trusted',
		},
		planMode: {
			activateForSpawn: vi.fn(),
			hasSubmittedPlan: vi.fn(() => false),
			isActive: vi.fn(() => options.planning ?? false),
			releaseSession: vi.fn(),
		},
		...(options.secretValues === null
			? {}
			: {
					secretValues: options.secretValues ?? {
						readSecretValues: vi.fn(
							async (workspaceId: string) =>
								SECRETS_BY_WORKSPACE[workspaceId] ?? [],
						),
					},
				}),
	}) as unknown as AgentControlPorts;

/**
 * Registers a caller in `ws-a` (token `tok-a1`, or a leaf beneath two parents
 * when `leaf`), a peer in `ws-a` (`tok-a2`), a session in `ws-b` (`tok-b1`),
 * and the Concierge (`tok-concierge`).
 */
const setup = (options: SetupOptions = {}) => {
	const registry = createOriginRegistry({
		generateToken: (() => {
			const tokens = [
				'tok-root',
				'tok-mid',
				'tok-a1',
				'tok-a2',
				'tok-b1',
				'tok-concierge',
			];
			let issued = 0;
			return () => tokens[issued++] ?? `tok-${issued}`;
		})(),
	});
	registry.register({
		sessionId: 'root',
		species: 'claude',
		workspaceCwd: '/a',
		workspaceId: 'ws-a',
	});
	registry.register({
		parentSessionId: 'root',
		sessionId: 'mid',
		species: 'claude',
		workspaceCwd: '/a',
		workspaceId: 'ws-a',
	});
	registry.register({
		parentSessionId: options.leaf ? 'mid' : undefined,
		sessionId: 'caller',
		species: 'claude',
		workspaceCwd: '/a',
		workspaceId: 'ws-a',
	});
	registry.register({
		sessionId: 'peer',
		species: 'harness',
		workspaceCwd: '/a',
		workspaceId: 'ws-a',
	});
	registry.register({
		sessionId: 'other',
		species: 'claude',
		workspaceCwd: '/b',
		workspaceId: 'ws-b',
	});
	registry.register({
		concierge: true,
		sessionId: 'concierge',
		species: 'claude',
		workspaceCwd: '/home',
		workspaceId: '',
	});
	const ports = makePorts(options);
	const service = createAgentControlService({
		guardrails: createGuardrails(),
		originRegistry: registry,
		ports,
	});
	return { ports, registry, service };
};

const EVERY_VALUE = `${A_SECRET} ${B_SECRET} tok-root tok-a1 tok-a2 tok-b1 tok-concierge`;

describe('redactText', () => {
	it("redacts the caller's workspace secrets and every token minted there, and nothing of another workspace", async () => {
		const { service } = setup();

		const result = await service.invoke({
			op: 'redactText',
			rawArgs: { text: EVERY_VALUE },
			token: 'tok-a1',
		});

		expect(result).toEqual({
			data: {
				redacted: 4,
				text: `[redacted:API_KEY] ${B_SECRET} [redacted:ENSEMBLR_CONTROL_TOKEN] [redacted:ENSEMBLR_CONTROL_TOKEN] [redacted:ENSEMBLR_CONTROL_TOKEN] tok-b1 tok-concierge`,
			},
			ok: true,
		});
	});

	it("redacts workspace B's own values for a caller there, and never workspace A's", async () => {
		const { service } = setup();

		const result = await service.invoke({
			op: 'redactText',
			rawArgs: { text: EVERY_VALUE },
			token: 'tok-b1',
		});

		expect(result.ok && (result.data as { text: string }).text).toBe(
			`${A_SECRET} [redacted:B_KEY] tok-root tok-a1 tok-a2 [redacted:ENSEMBLR_CONTROL_TOKEN] tok-concierge`,
		);
	});

	it('redacts only its own token for the Concierge, which has no workspace', async () => {
		const secretValues = { readSecretValues: vi.fn() };
		const { service } = setup({ secretValues });

		const result = await service.invoke({
			op: 'redactText',
			rawArgs: { text: EVERY_VALUE },
			token: 'tok-concierge',
		});

		expect(result.ok && (result.data as { text: string }).text).toBe(
			`${A_SECRET} ${B_SECRET} tok-root tok-a1 tok-a2 tok-b1 [redacted:ENSEMBLR_CONTROL_TOKEN]`,
		);
		expect(secretValues.readSecretValues).not.toHaveBeenCalled();
	});

	it('still redacts tokens when the secret values cannot be read', async () => {
		const { service } = setup({
			secretValues: {
				readSecretValues: vi.fn().mockRejectedValue(new Error('offline')),
			},
		});

		const result = await service.invoke({
			op: 'redactText',
			rawArgs: { text: `${A_SECRET} tok-a1` },
			token: 'tok-a1',
		});

		expect(result).toEqual({
			data: {
				redacted: 1,
				text: `${A_SECRET} [redacted:ENSEMBLR_CONTROL_TOKEN]`,
			},
			ok: true,
		});
	});

	it('redacts tokens alone when no secret-values port is wired', async () => {
		const { service } = setup({ secretValues: null });

		const result = await service.invoke({
			op: 'redactText',
			rawArgs: { text: `${A_SECRET} tok-a2` },
			token: 'tok-a1',
		});

		expect(result.ok && (result.data as { text: string }).text).toBe(
			`${A_SECRET} [redacted:ENSEMBLR_CONTROL_TOKEN]`,
		);
	});

	it('answers a zero count with the text unchanged when nothing matches', async () => {
		const { service } = setup();

		const result = await service.invoke({
			op: 'redactText',
			rawArgs: { text: 'plain output' },
			token: 'tok-a1',
		});

		expect(result).toEqual({
			data: { redacted: 0, text: 'plain output' },
			ok: true,
		});
	});

	it.each([
		['Plan Mode', { planning: true }],
		['AFK', { afk: true }],
		['a leaf sub-agent', { leaf: true }],
		['a read-only workspace', { permissionMode: 'read-only' as const }],
		['a retired Concierge', {}],
	])('is allowed for %s without asking the user', async (label, options) => {
		const { ports, registry, service } = setup(options);
		const token = label === 'a retired Concierge' ? 'tok-concierge' : 'tok-a1';
		if (label === 'a retired Concierge') {
			registry.retire('concierge');
		}

		const result = await service.invoke({
			op: 'redactText',
			rawArgs: { text: 'tok-a1' },
			token,
		});

		expect(result.ok).toBe(true);
		expect(ports.confirm.confirm).not.toHaveBeenCalled();
	});

	it('is never rate-limited, because a mod calls it once per conversation row', async () => {
		const { service } = setup();

		const results = await Promise.all(
			Array.from({ length: 250 }, () =>
				service.invoke({
					op: 'redactText',
					rawArgs: { text: 'tok-a1' },
					token: 'tok-a1',
				}),
			),
		);

		expect(results.every((result) => result.ok)).toBe(true);
	});

	it('refuses text over the limit without echoing it back', async () => {
		const { service } = setup();
		const text = `${A_SECRET}${'x'.repeat(MOD_CONTROL_LIMITS.maxTextChars)}`;

		const result = await service.invoke({
			op: 'redactText',
			rawArgs: { text },
			token: 'tok-a1',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('invalid-args');
			expect(result.error).not.toContain(A_SECRET);
		}
	});
});

describe('getLinkedIssue', () => {
	it('answers null when the workspace has no linked issue', async () => {
		const { service } = setup({ linkedIssue: null });

		expect(
			await service.invoke({
				op: 'getLinkedIssue',
				rawArgs: {},
				token: 'tok-a1',
			}),
		).toEqual({ data: { issue: null }, ok: true });
	});

	it('answers null for a GitHub-linked workspace', async () => {
		const { service } = setup({
			linkedIssue: { ...LINKED_ISSUE, accountId: null, provider: 'github' },
		});

		expect(
			await service.invoke({
				op: 'getLinkedIssue',
				rawArgs: {},
				token: 'tok-a1',
			}),
		).toEqual({ data: { issue: null }, ok: true });
	});

	it("reads the description off Linear with the workspace's account, capped", async () => {
		const getIssue = vi.fn().mockResolvedValue({
			issue: {
				description: 'd'.repeat(MOD_CONTROL_LIMITS.maxDescriptionChars + 50),
			},
			status: 'ok',
		});
		const { service } = setup({ getIssue, linkedIssue: LINKED_ISSUE });

		const result = await service.invoke({
			op: 'getLinkedIssue',
			rawArgs: {},
			token: 'tok-a1',
		});

		expect(getIssue).toHaveBeenCalledWith({
			accountId: 'acct-1',
			issueId: 'ENG-7',
			workspaceId: 'ws-a',
		});
		expect(result).toEqual({
			data: {
				issue: {
					description: 'd'.repeat(MOD_CONTROL_LIMITS.maxDescriptionChars),
					identifier: 'ENG-7',
					title: 'Ship the mods',
					url: 'https://linear.app/x/issue/ENG-7',
				},
			},
			ok: true,
		});
	});

	it.each([
		[
			'Linear is not connected',
			vi.fn().mockResolvedValue({ issue: null, status: 'not-connected' }),
		],
		['the Linear read throws', vi.fn().mockRejectedValue(new Error('down'))],
	])(
		'keeps the issue with a null description when %s',
		async (_label, getIssue) => {
			const { service } = setup({ getIssue, linkedIssue: LINKED_ISSUE });

			const result = await service.invoke({
				op: 'getLinkedIssue',
				rawArgs: {},
				token: 'tok-a1',
			});

			expect(result).toEqual({
				data: {
					issue: {
						description: null,
						identifier: 'ENG-7',
						title: 'Ship the mods',
						url: 'https://linear.app/x/issue/ENG-7',
					},
				},
				ok: true,
			});
		},
	);

	it('answers null for the Concierge without reading any workspace', async () => {
		const { ports, service } = setup({ linkedIssue: LINKED_ISSUE });

		expect(
			await service.invoke({
				op: 'getLinkedIssue',
				rawArgs: {},
				token: 'tok-concierge',
			}),
		).toEqual({ data: { issue: null }, ok: true });
		expect(ports.linear.readLinkedIssue).not.toHaveBeenCalled();
	});

	it('is allowed in Plan Mode for a leaf sub-agent', async () => {
		const { service } = setup({
			leaf: true,
			linkedIssue: null,
			planning: true,
		});

		expect(
			(
				await service.invoke({
					op: 'getLinkedIssue',
					rawArgs: {},
					token: 'tok-a1',
				})
			).ok,
		).toBe(true);
	});
});

describe('the mod ops over MCP', () => {
	it('registers neither as an MCP tool', () => {
		const ops = new Set(TOOL_DEFS.map((def) => def.op));
		expect(ops.has('redactText')).toBe(false);
		expect(ops.has('getLinkedIssue')).toBe(false);
	});
});
