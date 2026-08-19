import type { AppSettings } from '../../shared/config.ts';
import type { AppLanguage } from '../../shared/i18n.ts';
import type { AgentSessionEventWire } from '../../shared/ipc/contracts/agent-session.ts';
import type {
	ChatTurnFinishedBroadcast,
	FocusChatBroadcast,
} from '../../shared/ipc/contracts/notifications.ts';
import type { OnScreenChatRef } from './active-chat-store.ts';
import {
	type NotificationKind,
	notificationText,
} from './notification-strings.ts';
import type { NotificationTarget } from './notification-target.ts';

/** One persisted agent event plus the session and workspace it belongs to. */
interface AgentActivityEvent {
	event: AgentSessionEventWire;
	sessionId: string;
	workspaceId: string;
}

/**
 * A desktop notification, and the chat clicking it should open. `playSound`
 * carries the `notificationSound` setting as read when the notification was
 * raised, so the renderer that owns the audio never re-derives the gate.
 */
export interface AgentNotification {
	body: string;
	playSound: boolean;
	target: FocusChatBroadcast;
	title: string;
}

/** A session the monitor currently believes is mid-turn, and where it lives. */
export interface RunningAgentSession {
	sessionId: string;
	workspaceId: string;
}

/** Thin seam over Electron's `powerSaveBlocker` so the monitor stays testable. */
export interface PowerSaveControls {
	start: (type: 'prevent-app-suspension' | 'prevent-display-sleep') => number;
	stop: (id: number) => void;
}

/** Current battery reading; `charging` includes "on AC power". */
export interface BatterySnapshot {
	charging: boolean;
	percent: number;
}

/** Options for {@link createAgentActivityMonitor}. */
export interface AgentActivityMonitorOptions {
	/** Reads the live App settings (config.json is the source of truth). */
	readSettings: () => AppSettings;
	/** Power-blocker seam; defaults to Electron's `powerSaveBlocker`. */
	powerControls?: PowerSaveControls;
	/** Emits a desktop notification; defaults to Electron `Notification`. */
	notify?: (notification: AgentNotification) => void;
	/**
	 * Announces a finished top-level turn to every window, which is what the
	 * renderer marks a chat unread from. Fires regardless of the notification
	 * setting and of window focus: it says a chat is done, not that the OS should
	 * interrupt.
	 */
	announceTurnFinished?: (broadcast: ChatTurnFinishedBroadcast) => void;
	/** True when any app window is focused. */
	isAppFocused?: () => boolean;
	/**
	 * True when the renderer reports this exact chat as the one on screen. Asked
	 * with the tab id the target resolved as well as the session id, because the
	 * renderer reports whichever session its tab list has resolved and that can
	 * lag the one the runtime is running.
	 */
	isChatOnScreen?: (chat: OnScreenChatRef) => boolean;
	/** Reads the workspace name, tab title, and sub-agent marker behind a session. */
	resolveTarget?: (
		workspaceId: string,
		agentSessionId: string,
	) => NotificationTarget | null;
	/** The language notification copy is rendered in. */
	readLanguage?: () => AppLanguage;
	/**
	 * Reads the current battery, or `null` when unknown / no battery. Async so the
	 * real (`pmset`) implementation never blocks the main thread; the monitor
	 * caches the result and reconciles when it resolves.
	 */
	readBattery?: () => Promise<BatterySnapshot | null>;
	/** Schedules the recurring battery re-check; returns a canceller. */
	scheduleInterval?: (callback: () => void, ms: number) => () => void;
	/** Monotonic clock for the sample-freshness TTL; defaults to `Date.now`. */
	now?: () => number;
}

/** Public surface of the agent activity monitor. */
interface AgentActivityMonitor {
	/** Feed every persisted agent session event here. */
	handle: (input: AgentActivityEvent) => void;
	/**
	 * Records that the user stopped this session, so the `idle` its abort emits
	 * on the way out does not read as a turn that finished on its own.
	 */
	noteUserStop: (sessionId: string) => void;
	/** Notifies that an agent is blocked on a questionnaire it raised. */
	notifyQuestionRaised: (input: {
		workspaceId: string;
		agentSessionId: string;
	}) => void;
	/** Every session currently mid-turn, across all workspaces. */
	listRunning: () => readonly RunningAgentSession[];
	/** Re-evaluate the power blocker (e.g. after a settings change). */
	refresh: () => void;
	/** Release the blocker and timers (call on app quit). */
	dispose: () => void;
}

/** Below this charge (and not charging) the caffeinate blocker shuts off. */
const BATTERY_CUTOFF_PERCENT = 10;
/** How often to re-check the battery while the blocker is engaged. */
const BATTERY_POLL_MS = 60_000;
/** A cached battery reading older than this is refreshed before it's trusted. */
const BATTERY_SAMPLE_TTL_MS = 30_000;

// Inert defaults keep this module free of the `electron` import so it unit-tests
// under a plain Node/bun runtime. The real Electron-backed controls, notifier,
// and focus check are injected from `electron-activity-bindings.ts` in main.ts.
const inertPowerControls: PowerSaveControls = {
	/** Inert power-blocker start; returns a placeholder id. */
	start: () => 0,
	/** Inert power-blocker stop; does nothing. */
	stop: () => undefined,
};

/**
 * Default interval scheduler backed by `setInterval`.
 * @param callback - Function to run on each tick.
 * @param ms - Interval delay in milliseconds.
 * @returns A canceller that clears the interval.
 */
function defaultSchedule(callback: () => void, ms: number): () => void {
	const timer = setInterval(callback, ms);
	return () => clearInterval(timer);
}

/**
 * Drives the two main-process side-effects behind the General settings:
 * `caffeinateWhileRunning` (hold a power-save blocker while any session is
 * streaming) and `desktopNotifications`.
 *
 * A chat wants the user when a top-level agent finishes its turn or blocks on a
 * questionnaire. Three things refuse that outright — the chat hosting somebody's
 * sub-agent, an `idle` that is only the tail of a stop the user asked for, and a
 * chat {@link AgentActivityMonitorOptions.resolveTarget} cannot name at all —
 * and the monitor is where all three are known, so it is the one place that
 * decides. The third costs the unread mark as well as the notification, which
 * the renderer's own event stream would have made anyway; a chat nobody can
 * attribute is worth less than the wrong chat going bold.
 *
 * The decision fans out to two surfaces with different appetites.
 * {@link AgentActivityMonitorOptions.announceTurnFinished} carries it to the
 * renderer, which marks the chat unread; that must survive both the
 * notification setting being off and the window having focus. The desktop
 * notification applies those two on top. Keeping the shared half here is what
 * stops the unread mark and the notification disagreeing about whose turn a
 * sub-agent's is — the renderer sees only raw session events and can tell
 * neither a sub-agent nor a user-requested stop from an ordinary finish.
 *
 * Streaming state is derived from persisted `status` / `shutdown` events, so the
 * monitor never has to poll session rows. Settings are read live on each
 * relevant event, so toggling a switch takes effect without a restart.
 *
 * That same state is the process-wide answer to "which sessions are working
 * right now", which {@link listRunning} exposes for the quit guard. It is more
 * accurate than the persisted rows for this: the set starts empty at boot, so a
 * prior run that died mid-turn leaves no phantom entry behind.
 */
export function createAgentActivityMonitor(
	options: AgentActivityMonitorOptions,
): AgentActivityMonitor {
	const power = options.powerControls ?? inertPowerControls;
	const notify = options.notify ?? (() => undefined);
	const announceTurnFinished =
		options.announceTurnFinished ?? (() => undefined);
	const isAppFocused = options.isAppFocused ?? (() => false);
	const isChatOnScreen = options.isChatOnScreen ?? (() => false);
	const resolveTarget = options.resolveTarget ?? (() => null);
	const readLanguage = options.readLanguage ?? ((): AppLanguage => 'en');
	const readBattery = options.readBattery ?? (() => Promise.resolve(null));
	const scheduleInterval = options.scheduleInterval ?? defaultSchedule;
	const now = options.now ?? Date.now;

	const streamingSessions = new Map<string, string>();
	const userStoppedSessions = new Set<string>();
	let blockerId: number | null = null;
	let cancelPoll: (() => void) | null = null;

	// Cached battery reading. The async `readBattery` never runs on the hot path;
	// `reconcilePower` consults this snapshot and refreshes it in the background.
	let lastBattery: BatterySnapshot | null = null;
	let batterySampledAt = Number.NEGATIVE_INFINITY;
	let sampling = false;

	const batteryAllowsBlock = (): boolean => {
		if (!lastBattery || lastBattery.charging) {
			return true;
		}
		return lastBattery.percent >= BATTERY_CUTOFF_PERCENT;
	};

	// Refresh the cached reading off the main thread, then re-reconcile so a
	// drained laptop releases the blocker (and a freshly-plugged one re-engages).
	const sampleBattery = (): void => {
		if (sampling) {
			return;
		}
		sampling = true;
		void readBattery()
			.then((battery) => {
				lastBattery = battery;
			})
			.catch(() => {
				lastBattery = null;
			})
			.finally(() => {
				batterySampledAt = now();
				sampling = false;
				reconcilePower();
			});
	};

	const reconcilePower = (): void => {
		const settings = options.readSettings();
		const wantBlock =
			settings.general.caffeinateWhileRunning && streamingSessions.size > 0;
		if (wantBlock && now() - batterySampledAt >= BATTERY_SAMPLE_TTL_MS) {
			const firstSample = batterySampledAt === Number.NEGATIVE_INFINITY;
			sampleBattery();
			// On the very first read, defer the decision until it lands so we never
			// engage on battery only to release it a tick later.
			if (firstSample) {
				return;
			}
		}
		const shouldBlock = wantBlock && batteryAllowsBlock();
		if (shouldBlock && blockerId === null) {
			blockerId = power.start('prevent-app-suspension');
			// Force-refresh the battery while engaged (bypassing the TTL gate) so a
			// draining laptop releases the blocker; `sampleBattery` re-reconciles.
			cancelPoll = scheduleInterval(sampleBattery, BATTERY_POLL_MS);
		} else if (!shouldBlock && blockerId !== null) {
			power.stop(blockerId);
			blockerId = null;
			cancelPoll?.();
			cancelPoll = null;
		}
	};

	// A chat the user is looking at needs no notification, but "looking at" means
	// this chat on screen in a focused window — not merely that the app has focus
	// somewhere, which used to swallow every background chat's notification.
	const shouldStaySilent = (
		agentSessionId: string,
		target: NotificationTarget,
	): boolean =>
		!options.readSettings().general.desktopNotifications ||
		(isAppFocused() &&
			isChatOnScreen({
				agentSessionId,
				chatTabId: target.chatTabId,
				workspaceId: target.workspaceId,
			}));

	// Resolved before the silence gate rather than after it, so the announcement
	// still carries the sub-agent verdict when notifications are switched off.
	// One indexed row read per turn end, never per streamed event.
	const resolveAttentionTarget = (
		workspaceId: string,
		agentSessionId: string,
	): NotificationTarget | null => {
		const target = resolveTarget(workspaceId, agentSessionId);
		// A sub-agent finishing is its orchestrator's business, not the user's: a
		// delegating turn would otherwise fire one notification per child.
		return target && !target.isSubAgent ? target : null;
	};

	const emitNotification = (
		kind: NotificationKind,
		agentSessionId: string,
		target: NotificationTarget,
	): void => {
		if (shouldStaySilent(agentSessionId, target)) {
			return;
		}
		notify({
			...notificationText({
				kind,
				language: readLanguage(),
				tabTitle: target.tabTitle,
				workspaceName: target.workspaceName,
			}),
			playSound: options.readSettings().general.notificationSound,
			target: {
				agentSessionId,
				chatTabId: target.chatTabId,
				workspaceId: target.workspaceId,
			},
		});
	};

	const reportTurnFinished = (
		workspaceId: string,
		agentSessionId: string,
		finishedAt: string,
	): void => {
		const target = resolveAttentionTarget(workspaceId, agentSessionId);
		if (!target) {
			return;
		}
		announceTurnFinished({
			agentSessionId,
			chatTabId: target.chatTabId,
			finishedAt,
			workspaceId,
		});
		emitNotification('finished', agentSessionId, target);
	};

	const handle = ({
		event,
		sessionId,
		workspaceId,
	}: AgentActivityEvent): void => {
		const payload = event.payload;
		if (!payload) {
			return;
		}
		if (payload.kind === 'status') {
			const active =
				payload.status === 'streaming' || payload.status === 'starting';
			if (active) {
				streamingSessions.set(sessionId, workspaceId);
			} else {
				const wasActive = streamingSessions.delete(sessionId);
				const stoppedByUser = userStoppedSessions.delete(sessionId);
				if (wasActive && !stoppedByUser && payload.status === 'idle') {
					reportTurnFinished(workspaceId, sessionId, event.createdAt);
				}
			}
			reconcilePower();
			return;
		}
		if (payload.kind === 'shutdown') {
			streamingSessions.delete(sessionId);
			userStoppedSessions.delete(sessionId);
			reconcilePower();
		}
	};

	const listRunning = (): readonly RunningAgentSession[] =>
		[...streamingSessions].map(([sessionId, workspaceId]) => ({
			sessionId,
			workspaceId,
		}));

	const dispose = (): void => {
		cancelPoll?.();
		cancelPoll = null;
		if (blockerId !== null) {
			power.stop(blockerId);
			blockerId = null;
		}
		streamingSessions.clear();
		userStoppedSessions.clear();
	};

	return {
		dispose,
		handle,
		listRunning,
		noteUserStop: (sessionId) => {
			userStoppedSessions.add(sessionId);
		},
		notifyQuestionRaised: ({ agentSessionId, workspaceId }) => {
			const target = resolveAttentionTarget(workspaceId, agentSessionId);
			if (target) {
				emitNotification('question', agentSessionId, target);
			}
		},
		refresh: reconcilePower,
	};
}
