import { describe, expect, it, vi } from 'vitest';

const handle = vi.fn();

vi.mock('electron', () => ({
	BrowserWindow: { fromWebContents: () => null },
	dialog: { showOpenDialog: vi.fn() },
	ipcMain: { handle },
}));

const { createAfkModeRegistry } = await import(
	'../../src/main/afk-mode/afk-mode-registry.ts'
);
const { createPlanModeRegistry } = await import(
	'../../src/main/plan-mode/plan-mode-registry.ts'
);
const { registerAgentSessionHandlers } = await import(
	'../../src/main/ipc/handlers/agent-session.ts'
);
const { IPC_CHANNELS } = await import('../../src/shared/ipc/channels.ts');

const SESSION_ID = 'agent-1';
const WORKSPACE_ID = 'ws-1';

/**
 * Registers the handlers against real registries and returns them alongside the
 * two channels the toggles ride. Real registries rather than spies: exclusivity
 * is a property of the pair's resulting state, and asserting on setter calls
 * would pass for an implementation that set them in the wrong order.
 */
const setup = () => {
	handle.mockClear();
	const afkModeRegistry = createAfkModeRegistry();
	const planModeRegistry = createPlanModeRegistry();
	registerAgentSessionHandlers({
		afkModeRegistry,
		agentModelCatalog: {
			list: async () => ({ defaultModelId: null, models: [] }),
			resolveAgentProvider: async () => 'pi',
		} as never,
		agentSessionService: {
			openSession: async () => ({
				branchId: 'b',
				chatTabId: null,
				id: SESSION_ID,
				workspaceId: WORKSPACE_ID,
			}),
			submitPrompt: async () => ({
				acceptedAt: '2026-09-05T00:00:00.000Z',
				turnId: 'turn-1',
			}),
		} as never,
		piExecutableService: {
			getSnapshot: async () => ({ command: 'pi', status: 'ready' }),
		} as never,
		planModeRegistry,
		provisionalNamingQueue: () => undefined,
		withPermissionGate: () => undefined,
	});
	const channels = new Map<
		string,
		(event: unknown, raw: unknown) => Promise<unknown>
	>();
	for (const call of handle.mock.calls) {
		channels.set(call[0], call[1]);
	}
	return { afkModeRegistry, channels, planModeRegistry };
};

const submit = (
	channels: ReturnType<typeof setup>['channels'],
	modes: { afkMode?: boolean; planMode?: boolean },
) =>
	channels.get(IPC_CHANNELS.submitAgentPrompt)?.(null, {
		...modes,
		prompt: 'go',
		sessionId: SESSION_ID,
	});

describe('afk mode: exclusivity with Plan Mode', () => {
	it('clears Plan Mode when a turn arrives unattended', async () => {
		const { afkModeRegistry, channels, planModeRegistry } = setup();
		planModeRegistry.setActive(SESSION_ID, true);

		await submit(channels, { afkMode: true });

		expect(afkModeRegistry.isActive(SESSION_ID)).toBe(true);
		expect(planModeRegistry.isActive(SESSION_ID)).toBe(false);
	});

	it('clears AFK when a turn arrives planning', async () => {
		const { afkModeRegistry, channels, planModeRegistry } = setup();
		afkModeRegistry.setActive(SESSION_ID, true);

		await submit(channels, { planMode: true });

		expect(planModeRegistry.isActive(SESSION_ID)).toBe(true);
		expect(afkModeRegistry.isActive(SESSION_ID)).toBe(false);
	});

	// A stale window is the only sender that can state both. Plan Mode wins: it is
	// the more restrictive of the two, and AFK promises the agent keeps working,
	// which is the opposite of what a planning turn is for.
	it('resolves a request claiming both in favour of Plan Mode', async () => {
		const { afkModeRegistry, channels, planModeRegistry } = setup();

		await submit(channels, { afkMode: true, planMode: true });

		expect(planModeRegistry.isActive(SESSION_ID)).toBe(true);
		expect(afkModeRegistry.isActive(SESSION_ID)).toBe(false);
	});

	// An absent flag is "the user has no opinion about this tab", not "off": a
	// child that inherited either mode through the control layer would otherwise be
	// unblocked by the user's first message into it.
	it('clears neither when the request states no opinion', async () => {
		const { afkModeRegistry, channels, planModeRegistry } = setup();
		afkModeRegistry.setActive(SESSION_ID, true);

		await submit(channels, {});

		expect(afkModeRegistry.isActive(SESSION_ID)).toBe(true);
		expect(planModeRegistry.isActive(SESSION_ID)).toBe(false);
	});

	it('turns AFK off when the user states it directly', async () => {
		const { afkModeRegistry, channels } = setup();
		afkModeRegistry.setActive(SESSION_ID, true);

		await submit(channels, { afkMode: false });

		expect(afkModeRegistry.isActive(SESSION_ID)).toBe(false);
	});

	// Hand-off turns Plan Mode on or off without a prompt to carry the value. It
	// has no AFK counterpart, but turning planning ON through it has to clear AFK
	// for the same reason a submit does.
	it('clears AFK when `setAgentPlanMode` starts a session planning', async () => {
		const { afkModeRegistry, channels, planModeRegistry } = setup();
		afkModeRegistry.setActive(SESSION_ID, true);

		await channels.get(IPC_CHANNELS.setAgentPlanMode)?.(null, {
			planMode: true,
			sessionId: SESSION_ID,
		});

		expect(planModeRegistry.isActive(SESSION_ID)).toBe(true);
		expect(afkModeRegistry.isActive(SESSION_ID)).toBe(false);
	});

	it('leaves AFK alone when `setAgentPlanMode` ends planning', async () => {
		const { afkModeRegistry, channels, planModeRegistry } = setup();
		afkModeRegistry.setActive(SESSION_ID, true);
		planModeRegistry.setActive(SESSION_ID, true);

		await channels.get(IPC_CHANNELS.setAgentPlanMode)?.(null, {
			planMode: false,
			sessionId: SESSION_ID,
		});

		expect(planModeRegistry.isActive(SESSION_ID)).toBe(false);
		expect(afkModeRegistry.isActive(SESSION_ID)).toBe(true);
	});

	it('carries the flag on the open request too', async () => {
		const { afkModeRegistry, channels } = setup();

		await channels.get(IPC_CHANNELS.openAgentSession)?.(null, {
			afkMode: true,
			workspaceCwd: '/ws',
			workspaceId: WORKSPACE_ID,
		});

		expect(afkModeRegistry.isActive(SESSION_ID)).toBe(true);
	});
});
