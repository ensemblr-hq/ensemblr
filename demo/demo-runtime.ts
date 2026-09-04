import type { QueryClient } from '@tanstack/react-query';

import type { ExitPlanModeBroadcast } from '@/shared/agent-control';
import type { AgentSessionEventBroadcast } from '@/shared/ipc/contracts/agent-session';

import {
	type DemoBridgeHandlers,
	DemoBroadcastChannels,
	installDemoBridge,
} from './demo-bridge.ts';
import {
	AGENT_EVENT_CHANNEL,
	CONCIERGE_FOCUS_CHANNEL,
	createDemoHandlers,
	EXIT_PLAN_MODE_CHANNEL,
} from './handlers.ts';
import {
	applyPlayhead,
	type Playhead,
	parsePlayhead,
	replayTranscript,
} from './playhead.ts';
import type { DemoInteraction, DemoScenario } from './scenario.ts';

/** localStorage key the dashboard board reads its column assignment from. */
const BOARD_STATUS_KEY = 'ensemblr_workspace_board_status';

/** Chat tab id the scenario's own chat is bound to when it names none. */
const ACTIVE_TAB_ID = 'demo-chat';

/**
 * Prefix of the per-chat Plan Mode preference keys. `localStorage` outlives a
 * demo run, so every scenario clears these rather than only the one that stages
 * a plan — otherwise one plan-mode shot leaves the chip on in every shot taken
 * after it.
 */
const PLAN_MODE_KEY_PREFIX = 'ensemblr_pref_chat_plan_mode_';

/**
 * Holds the scenario the window is currently showing and the machinery that
 * swaps it.
 *
 * The bridge reads the scenario through this object on every call rather than
 * capturing it, which is what lets an edited scenario file take effect over HMR
 * without reinstalling the bridge or reloading the window.
 */
export class DemoRuntime {
	private readonly channels = new DemoBroadcastChannels();
	private handlers: DemoBridgeHandlers;
	private interactionCursor = 0;
	private playhead: Playhead;
	private scenario: DemoScenario;
	private source: DemoScenario;
	private stopReplay: (() => void) | null = null;

	/**
	 * @param scenario - Scenario to apply first.
	 * @param playhead - How much of its transcript to show.
	 */
	constructor(scenario: DemoScenario, playhead: Playhead) {
		this.source = scenario;
		this.playhead = playhead;
		this.scenario = applyPlayhead(scenario, playhead);
		this.handlers = createDemoHandlers(() => this.scenario, this.channels);
		seedBoardStatuses(scenario);
		seedPlanMode(scenario);
		installDemoBridge(() => this.handlers);
	}

	/** The scenario as the window is currently showing it. */
	get current(): DemoScenario {
		return this.scenario;
	}

	/** The scenario as authored, before the playhead cut its transcript. */
	get authored(): DemoScenario {
		return this.source;
	}

	/**
	 * Applies a scenario, discards every cached answer from the previous one, and
	 * restarts a live replay if one is running.
	 * @param scenario - Scenario to show.
	 * @param queryClient - Client whose cache is cleared so no stale answer survives the swap.
	 * @param playhead - How much of the transcript to show; unchanged when omitted.
	 */
	apply(
		scenario: DemoScenario,
		queryClient: QueryClient,
		playhead: Playhead = this.playhead,
	): void {
		this.stopReplay?.();
		this.stopReplay = null;
		this.interactionCursor = 0;
		this.source = scenario;
		this.playhead = playhead;
		this.scenario = applyPlayhead(scenario, playhead);
		seedBoardStatuses(scenario);
		seedPlanMode(scenario);
		queryClient.clear();
		if (playhead === 'live') {
			this.startReplay(queryClient);
		}
	}

	/**
	 * Starts a live replay when the initial playhead asked for one.
	 * @param queryClient - Client the replay's broadcasts invalidate.
	 */
	start(queryClient: QueryClient): void {
		if (this.playhead === 'live') {
			this.startReplay(queryClient);
		}
	}

	/**
	 * Raises the panels a scenario declares but no route can reach.
	 *
	 * The Concierge is opened by a request from main rather than by navigation, so
	 * it has to be asked for after the renderer has subscribed — which is why this
	 * is called from a mount effect rather than from {@link DemoRuntime.start}.
	 */
	openDeclaredPanels(): void {
		if (this.scenario.concierge) {
			this.channels.emit(CONCIERGE_FOCUS_CHANNEL, undefined);
		}
		const plan = this.scenario.planReview;
		if (plan) {
			this.channels.emit<ExitPlanModeBroadcast>(EXIT_PLAN_MODE_CHANNEL, {
				agentSessionId: this.scenario.chat.agentSessionId,
				planPath: plan.planPath,
				requestId: 'demo-plan-request',
				title: plan.title,
				workspaceId: this.scenario.workspaceId,
			});
		}
	}

	/**
	 * Applies the scenario's next gesture, if any is left.
	 *
	 * One per call rather than the whole list at once: a gesture that opens a
	 * dialog only reaches the DOM after React has re-rendered and the queries it
	 * kicked off have answered, so the next gesture has nothing to find until the
	 * caller has polled again. A gesture that matches nothing is reported rather
	 * than skipped silently — the failure mode it otherwise produces is a shot of
	 * the wrong screen, which reads as correct.
	 * @returns True when a gesture was applied, false once the list is spent.
	 */
	applyNextInteraction(): boolean {
		const interaction = this.scenario.interactions[this.interactionCursor];
		if (!interaction) {
			return false;
		}
		this.interactionCursor += 1;
		const target = findInteractionTarget(interaction);
		if (!target) {
			console.error('Demo interaction matched no element:', interaction);
			return true;
		}
		if (interaction.kind === 'click') {
			pressElement(target);
			return true;
		}
		if (interaction.kind === 'context-menu') {
			openContextMenu(target);
			return true;
		}
		if (interaction.kind === 'press-key') {
			pressKey(target, interaction.key);
			return true;
		}
		target.scrollIntoView({ block: 'center' });
		return true;
	}

	/**
	 * Feeds the authored transcript back one event at a time, appending each to
	 * the scenario the bridge serves and broadcasting it exactly as the main
	 * process would.
	 * @param queryClient - Client the broadcast's own listener updates.
	 */
	private startReplay(queryClient: QueryClient): void {
		const source = this.source;
		this.stopReplay = replayTranscript(source, (index) => {
			const event = source.chat.transcript[index];
			if (!event) {
				return;
			}
			this.scenario = {
				...this.scenario,
				chat: {
					...this.scenario.chat,
					transcript: [...this.scenario.chat.transcript, event],
				},
			};
			this.channels.emit<AgentSessionEventBroadcast>(AGENT_EVENT_CHANNEL, {
				event,
				sessionId: source.chat.agentSessionId,
				workspaceId: source.workspaceId,
			});
			void queryClient.invalidateQueries();
		});
	}
}

/**
 * Presses a control the way a pointer does, rather than only calling `click()`.
 *
 * Radix opens a dropdown on `pointerdown` and activates a tab trigger on
 * `mousedown`, while an ordinary shadcn button reads only `click` — a gesture
 * that sent one of the three would silently do nothing on the other two.
 * @param target - Element to press.
 */
function pressElement(target: HTMLElement): void {
	for (const type of ['pointerdown', 'pointerup']) {
		target.dispatchEvent(
			new PointerEvent(type, {
				bubbles: true,
				button: 0,
				cancelable: true,
				pointerId: 1,
				pointerType: 'mouse',
			}),
		);
	}
	for (const type of ['mousedown', 'mouseup']) {
		target.dispatchEvent(
			new MouseEvent(type, { bubbles: true, button: 0, cancelable: true }),
		);
	}
	target.click();
}

/**
 * Right-clicks an element at its own centre.
 *
 * Radix anchors a context menu to the pointer position the event carries, so a
 * `contextmenu` dispatched with the default coordinates of `0,0` opens the menu
 * in the window's top-left corner rather than over the card that owns it.
 * @param target - Element to open the context menu on.
 */
function openContextMenu(target: HTMLElement): void {
	const bounds = target.getBoundingClientRect();
	target.dispatchEvent(
		new MouseEvent('contextmenu', {
			bubbles: true,
			button: 2,
			cancelable: true,
			clientX: bounds.left + bounds.width / 2,
			clientY: bounds.top + bounds.height / 2,
		}),
	);
}

/**
 * Sends one key to an element.
 *
 * The command palette the create-from dialog is built on re-selects its first
 * row only when the *search* changes, so switching its source tab leaves the
 * selection pointing at a row that no longer exists — and the row actions, which
 * render only for the selected or hovered row, disappear with it. An arrow key
 * puts the selection back, which no click can do without also dispatching the
 * row's action and closing the dialog.
 * @param target - Element the key is dispatched from.
 * @param key - `KeyboardEvent.key` value to send.
 */
function pressKey(target: HTMLElement, key: string): void {
	for (const type of ['keydown', 'keyup']) {
		target.dispatchEvent(
			new KeyboardEvent(type, { bubbles: true, cancelable: true, key }),
		);
	}
}

/**
 * Resolves the element a gesture addresses, narrowing by visible text when the
 * gesture carries one — the controls a scenario reaches for are Radix triggers
 * and shadcn buttons, neither of which carries an id stable across a render.
 * @param interaction - Gesture being applied.
 * @returns The matching element, or null when the selector and text match none.
 */
function findInteractionTarget(
	interaction: DemoInteraction,
): HTMLElement | null {
	const candidates = [
		...document.querySelectorAll<HTMLElement>(interaction.selector),
	];
	const text = interaction.text;
	if (!text) {
		return candidates.at(0) ?? null;
	}
	return (
		candidates.find((candidate) => candidate.textContent?.includes(text)) ??
		null
	);
}

/**
 * Turns the open chat's Plan Mode chip on when the scenario stages a plan.
 *
 * The chip reads a `localStorage`-backed atom keyed by chat tab, not anything
 * the bridge answers, so a plan raised without this shows a decision bar over a
 * composer whose Plan Mode chip is off — a state the app never produces. Every
 * other scenario clears the keys for the same reason in reverse.
 * @param scenario - Scenario being applied.
 */
function seedPlanMode(scenario: DemoScenario): void {
	for (const key of Object.keys(window.localStorage)) {
		if (key.startsWith(PLAN_MODE_KEY_PREFIX)) {
			window.localStorage.removeItem(key);
		}
	}
	if (!scenario.planReview) {
		return;
	}
	const tabId = scenario.chat.tabId ?? ACTIVE_TAB_ID;
	window.localStorage.setItem(
		`${PLAN_MODE_KEY_PREFIX}${tabId}`,
		JSON.stringify(true),
	);
}

/**
 * Writes a scenario's board columns into the store the dashboard reads.
 *
 * The board's status map is a `localStorage`-backed Jotai atom rather than
 * anything the bridge answers, so a scenario that wants cards spread across
 * columns has to seed it before the atom is first read.
 * @param scenario - Scenario being applied.
 */
function seedBoardStatuses(scenario: DemoScenario): void {
	window.localStorage.setItem(
		BOARD_STATUS_KEY,
		JSON.stringify(scenario.boardStatusByWorkspaceId),
	);
}

/**
 * Reads which scenario and playhead the window was opened with.
 * @param search - The window's query string.
 * @returns The requested scenario id (null when unspecified) and the playhead.
 */
export function readDemoRequest(search: string): {
	playhead: Playhead;
	scenarioId: string | null;
} {
	const params = new URLSearchParams(search);
	return {
		playhead: parsePlayhead(params.get('step')),
		scenarioId: params.get('scenario'),
	};
}
