/**
 * Spawning a child on the costliest tier of model is put to the user, and
 * nothing else is.
 *
 * The rule the suite defends: only a model the caller *named* is gated.
 * Inheriting is the model the user already chose for that conversation, so
 * confirming every delegation out of a frontier chat would make the tier
 * unusable rather than deliberate — and the other route onto it, a spawn that
 * named nothing falling through to the catalog default, is closed in the
 * resolver instead, where there is nobody to ask.
 */
import { describe, expect, it, vi } from 'vitest';

import {
	type AgentControlPorts,
	createAgentControlService,
	createGuardrails,
	createOriginRegistry,
	type OriginRegistry,
} from '../../src/main/agent-control/index.ts';
import type { PermissionMode } from '../../src/shared/permissions.ts';

const CALLER = 'caller';
const FRONTIER_MODEL = 'claude-fable-5-1';
const STANDARD_MODEL = 'claude-opus-5';
const ALIAS_MODEL = 'model-7';

/**
 * Rows as `ensemblr_list_models` publishes them. `ALIAS_MODEL` is the case the
 * gate exists to get right: a moving alias whose id names no family, which the
 * picker names after the release it resolves to — so `tier` and the id disagree,
 * and only the row settles it.
 */
const CATALOG_ROWS = [
	{ displayName: 'Fable 5.1', id: FRONTIER_MODEL, tier: 'frontier' },
	{ displayName: 'Opus 5', id: STANDARD_MODEL, tier: 'standard' },
	{ displayName: 'Fable 5.1', id: ALIAS_MODEL, tier: 'frontier' },
];

/** Options every stub in {@link makePorts} varies on. */
interface PortOptions {
	confirm: ReturnType<typeof vi.fn>;
	/** What the gate reads the model's row off; defaults to {@link CATALOG_ROWS}. */
	listModels: ReturnType<typeof vi.fn>;
	mode?: PermissionMode;
	startConversation: ReturnType<typeof vi.fn>;
	unattended?: boolean;
}

/**
 * Ports for the frontier-tier cases. Only `confirm`,
 * `conversations.listModels`, and `conversations.startConversation` carry
 * behavior — the catalog the gate classifies against, the dialog it raises, and
 * the spawn it either permits or never reaches.
 */
const makePorts = (options: PortOptions): AgentControlPorts =>
	({
		afkMode: {
			activateForSpawn: vi.fn(),
			isActive: vi.fn(() => options.unattended === true),
			releaseSession: vi.fn(),
		},
		ask: { ask: vi.fn(), releaseSession: vi.fn() },
		board: {
			getWorkspaceStatus: vi.fn().mockReturnValue('backlog'),
			setWorkspaceStatus: vi.fn(),
		},
		commitCredit: { isCoAuthorEnabled: () => false },
		confirm: { confirm: options.confirm },
		conversations: {
			getLastMessage: vi.fn().mockResolvedValue('last'),
			getStatus: vi.fn().mockResolvedValue(null),
			hasFinalMessage: vi.fn().mockResolvedValue(false),
			isSpawnedSubAgent: vi.fn().mockResolvedValue(false),
			listModels: options.listModels,
			readTranscript: vi.fn(),
			resolveConversationWorkspace: vi.fn().mockResolvedValue('ws'),
			sendFollowUp: vi.fn().mockResolvedValue(undefined),
			setName: vi.fn().mockResolvedValue(null),
			startConversation: options.startConversation,
			waitForIdle: vi.fn().mockResolvedValue('completed'),
		},
		diff: { readWorkspaceDiff: vi.fn() },
		focus: {
			focusDockTab: vi.fn(),
			focusPanel: vi.fn(),
			focusTab: vi.fn(),
			focusWorkspace: vi.fn(),
		},
		harnesses: { launchHarness: vi.fn() },
		language: { getLanguage: () => 'en' },
		linear: { readLinkedIssue: vi.fn().mockReturnValue(null) },
		permissions: { getMode: () => options.mode ?? 'workspace-trusted' },
		planMode: {
			activateForSpawn: vi.fn(),
			exit: vi.fn(),
			hasSubmittedPlan: vi.fn(() => false),
			isActive: vi.fn(() => false),
			releaseSession: vi.fn(),
		},
		review: {
			addComments: vi.fn(),
			listComments: vi.fn(),
			resolveComments: vi.fn(),
		},
		sessionNaming: {
			readBrief: vi.fn().mockResolvedValue({
				branch: { current: null, eligible: false },
				diagram: { components: [], stale: false },
				summaryStale: false,
				titleNeeded: false,
			}),
		},
		tabs: {
			closeTab: vi.fn(),
			listTabs: vi.fn().mockResolvedValue([]),
			openNonChatTab: vi.fn(),
			resolveTabWorkspace: vi.fn().mockResolvedValue('ws'),
			spawnChatTab: vi.fn().mockResolvedValue({ chatTabId: 'new-tab' }),
		},
		terminals: {
			listRunScripts: vi.fn().mockResolvedValue({ scripts: [] }),
			listTerminals: vi.fn().mockResolvedValue([]),
			readOutput: vi.fn(),
			resolveTerminalWorkspace: vi.fn().mockResolvedValue('ws'),
			startTerminal: vi.fn(),
			stopTerminal: vi.fn(),
			writeTerminal: vi.fn(),
		},
		workspaces: {
			listProjects: vi.fn().mockResolvedValue([]),
			listWorkspaces: vi.fn().mockResolvedValue([]),
		},
	}) as unknown as AgentControlPorts;

/** Registers one orchestrator behind a predictable token and builds the service. */
const setup = (options: Partial<PortOptions> = {}) => {
	const confirm = options.confirm ?? vi.fn().mockResolvedValue(true);
	const listModels =
		options.listModels ??
		vi.fn().mockResolvedValue({
			defaultModelId: STANDARD_MODEL,
			models: CATALOG_ROWS,
		});
	const startConversation =
		options.startConversation ??
		vi.fn().mockResolvedValue({
			agentSessionId: 'child-1',
			chatTabId: 'child-tab',
			ok: true,
		});
	const registry: OriginRegistry = createOriginRegistry({
		generateToken: () => 'tok-caller',
	});
	registry.register({
		concierge: false,
		sessionId: CALLER,
		species: 'pi',
		workspaceCwd: '/ws',
		workspaceId: 'ws',
	});
	const ports = makePorts({
		...options,
		confirm,
		listModels,
		startConversation,
	});
	const service = createAgentControlService({
		guardrails: createGuardrails(),
		originRegistry: registry,
		ports,
	});
	return { confirm, listModels, ports, service, startConversation };
};

const spawn = (
	service: ReturnType<typeof setup>['service'],
	rawArgs: Record<string, unknown>,
) => service.invoke({ op: 'startConversation', rawArgs, token: 'tok-caller' });

describe('naming a frontier model', () => {
	// `workspace-trusted` is the user trusting an agent with their files, not with
	// their bill — so this dialog is raised in a mode that confirms nothing else.
	it('asks the user even in a mode that confirms nothing else', async () => {
		const { confirm, service, startConversation } = setup();

		const result = await spawn(service, {
			model: FRONTIER_MODEL,
			prompt: 'go',
		});

		expect(result.ok).toBe(true);
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(confirm.mock.calls[0]?.[0]?.summary).toContain(FRONTIER_MODEL);
		expect(startConversation).toHaveBeenCalledTimes(1);
	});

	it('never opens the conversation when the user declines', async () => {
		const confirm = vi.fn().mockResolvedValue(false);
		const { service, startConversation } = setup({ confirm });

		const result = await spawn(service, {
			model: FRONTIER_MODEL,
			prompt: 'go',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-permission');
			expect(result.error).toContain(FRONTIER_MODEL);
			expect(result.error).toContain('standard');
		}
		expect(startConversation).not.toHaveBeenCalled();
	});

	// One "yes" covers the fan-out it was given for. Five children onto the model
	// the user just approved is one decision, not five dialogs.
	it('remembers an approval for the same workspace and model', async () => {
		const { confirm, service, startConversation } = setup();

		await spawn(service, { model: FRONTIER_MODEL, prompt: 'first' });
		await spawn(service, { model: FRONTIER_MODEL, prompt: 'second' });
		await spawn(service, { model: FRONTIER_MODEL, prompt: 'third' });

		expect(confirm).toHaveBeenCalledTimes(1);
		expect(startConversation).toHaveBeenCalledTimes(3);
	});

	it('asks again for a different frontier model', async () => {
		const { confirm, service } = setup();

		await spawn(service, { model: FRONTIER_MODEL, prompt: 'first' });
		await spawn(service, { model: 'openai/gpt-astra', prompt: 'second' });

		expect(confirm).toHaveBeenCalledTimes(2);
	});

	// The row decides, not the string the caller passed. A runtime may advertise a
	// moving alias whose id names no family, and the picker names such a row after
	// the release it resolves to — so classifying the id alone would wave through
	// the very model `ensemblr_list_models` labels `frontier`.
	it('asks when only the display name names the frontier family', async () => {
		const { confirm, service, startConversation } = setup();

		const result = await spawn(service, { model: ALIAS_MODEL, prompt: 'go' });

		expect(result.ok).toBe(true);
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(confirm.mock.calls[0]?.[0]?.summary).toContain(ALIAS_MODEL);
		expect(startConversation).toHaveBeenCalledTimes(1);
	});

	// A catalog that failed to load must not be the thing that turns the gate off,
	// so the bare id still classifies when no row can be had.
	it('falls back to the id when the catalog cannot be read', async () => {
		const listModels = vi.fn().mockRejectedValue(new Error('catalog down'));
		const { confirm, service } = setup({ listModels });

		const result = await spawn(service, {
			model: FRONTIER_MODEL,
			prompt: 'go',
		});

		expect(result.ok).toBe(true);
		expect(confirm).toHaveBeenCalledTimes(1);
	});

	// The remembered approval is checked before the tier is, so the fan-out it was
	// given for costs one catalog read rather than one per child.
	it('reads the catalog once across a fan-out onto an approved model', async () => {
		const { listModels, service } = setup();

		await spawn(service, { model: FRONTIER_MODEL, prompt: 'first' });
		await spawn(service, { model: FRONTIER_MODEL, prompt: 'second' });
		await spawn(service, { model: FRONTIER_MODEL, prompt: 'third' });

		expect(listModels).toHaveBeenCalledTimes(1);
	});

	// Nobody is there to answer, so the spawn is refused rather than parked on a
	// dialog — and the refusal names the two ways forward.
	it('refuses rather than raising a dialog nobody will answer while the user is away', async () => {
		const { confirm, service, startConversation } = setup({
			unattended: true,
		});

		const result = await spawn(service, {
			model: FRONTIER_MODEL,
			prompt: 'go',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-permission');
			expect(result.error).toContain('Omit "model"');
		}
		expect(confirm).not.toHaveBeenCalled();
		expect(startConversation).not.toHaveBeenCalled();
	});
});

describe('everything else spawns without a dialog', () => {
	it('does not ask when the caller names a standard model', async () => {
		const { confirm, service, startConversation } = setup();

		const result = await spawn(service, {
			model: STANDARD_MODEL,
			prompt: 'go',
		});

		expect(result.ok).toBe(true);
		expect(confirm).not.toHaveBeenCalled();
		expect(startConversation).toHaveBeenCalledTimes(1);
	});

	// Inheriting is not escalation: the model a conversation runs on is one the
	// user picked, and it is the resolver rather than this gate that decides it —
	// so the gate reads no catalog on that path either.
	it('does not ask when the caller names no model at all', async () => {
		const { confirm, listModels, service, startConversation } = setup();

		const result = await spawn(service, { prompt: 'go' });

		expect(result.ok).toBe(true);
		expect(confirm).not.toHaveBeenCalled();
		expect(listModels).not.toHaveBeenCalled();
		expect(startConversation).toHaveBeenCalledTimes(1);
	});

	it('does not ask an unattended caller that inherits', async () => {
		const { confirm, service, startConversation } = setup({
			unattended: true,
		});

		const result = await spawn(service, { prompt: 'go' });

		expect(result.ok).toBe(true);
		expect(confirm).not.toHaveBeenCalled();
		expect(startConversation).toHaveBeenCalledTimes(1);
	});
});
