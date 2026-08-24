import { type AppSettings, DEFAULT_APP_SETTINGS } from '@/shared/config';
import type { AgentModelCatalog } from '@/shared/ipc/contracts/agent-models';
import { asModelVendorId } from '@/shared/ipc/contracts/agent-models';
import type { AgentPersistedEnvelope } from '@/shared/ipc/contracts/agent-session';
import type { ListAllChatTabsResult } from '@/shared/ipc/contracts/chat-tab';
import type {
	ClearConciergeContextResult,
	ConciergeContextPressureWire,
	ConciergeSessionEventWire,
	ConciergeSessionSnapshotWire,
	ListConciergeEventsResult,
	OpenConciergeSessionResult,
	StopConciergeSessionResult,
	SubmitConciergePromptResult,
} from '@/shared/ipc/contracts/concierge';
import type { DictationKeyStatus } from '@/shared/ipc/contracts/dictation';

/** The Concierge home every attachment and slash command resolves against. */
const CONCIERGE_CWD = '/Users/you/.ensemblr/concierge';

/** Session id the fixture transcript and the open call agree on. */
export const CONCIERGE_SESSION_ID = 'playground-concierge-session';

/** Fixed timestamp base, so a rebuild does not reshuffle the transcript. */
const EPOCH = Date.parse('2026-08-24T09:00:00.000Z');

/**
 * Which transcript the scene is showing. `empty` exercises the panel's own
 * invitation, `conversation` a settled exchange, and `streaming` the live turn
 * whose working indicator and Stop control only exist mid-flight.
 */
export type ConciergeFixtureTranscript = 'conversation' | 'empty' | 'streaming';

/** Two runtimes' models, so the Concierge picker can switch between them. */
const MODEL_CATALOG: AgentModelCatalog = {
	defaultModelId: 'claude-opus-5',
	defaultThinkingLevel: 'think',
	models: [
		{
			agentProvider: 'pi',
			contextWindow: 1_000_000,
			displayName: 'Opus 5',
			id: 'claude-opus-5',
			thinkingLevels: ['off', 'think', 'ultrathink'],
			vendor: asModelVendorId('anthropic'),
		},
		{
			agentProvider: 'pi',
			contextWindow: 1_000_000,
			displayName: 'Sonnet 5',
			id: 'claude-sonnet-5',
			thinkingLevels: ['off', 'think', 'ultrathink'],
			vendor: asModelVendorId('anthropic'),
		},
		{
			agentProvider: 'claude',
			contextWindow: 200_000,
			displayName: 'Claude Code — Opus 5',
			id: 'claude-code/opus-5',
			thinkingLevels: ['off', 'think', 'ultrathink'],
			vendor: asModelVendorId('claude-code'),
		},
	],
};

/**
 * Builds one transcript row at a fixed offset from the fixture epoch.
 * @param ordinal - Position in the transcript, which also spaces the timestamp.
 * @param payload - The persisted envelope the projector folds.
 * @returns The event as the renderer receives it.
 */
function event(
	ordinal: number,
	payload: AgentPersistedEnvelope,
): ConciergeSessionEventWire {
	return {
		createdAt: new Date(EPOCH + ordinal * 4_000).toISOString(),
		eventType: payload.kind,
		id: `${CONCIERGE_SESSION_ID}-${ordinal}`,
		ordinal,
		payload,
		sessionId: CONCIERGE_SESSION_ID,
		stream: 'protocol',
	};
}

/** A user turn, as the Concierge persists one. */
function prompt(ordinal: number, text: string): ConciergeSessionEventWire {
	return event(ordinal, {
		kind: 'message',
		payload: { kind: 'prompt', prompt: text },
		role: 'user',
	});
}

/** An agent turn's prose. */
function answer(ordinal: number, text: string): ConciergeSessionEventWire {
	return event(ordinal, {
		kind: 'message',
		payload: { kind: 'text', text },
		role: 'agent',
	});
}

const FIRST_ANSWER = `Three of your projects have uncommitted work right now.

- **ensemblr** — \`concierge-ui-polish\`, 6 files, all under \`src/renderer/components/concierge/\`.
- **yeco-connect** — \`lavrangas\`, one migration that never ran.
- **theswisscheese** — clean, but the branch is 14 commits behind \`master\`.

Want me to spawn an agent into the middle one and get that migration applied?`;

const SECOND_ANSWER = `Done — the agent is running in **yeco-connect** and I'll report back when it stops.

I also noted in memory that \`lavrangas\` is where the Prisma drift keeps showing up, so next time I can lead with that instead of scanning all three.`;

/** A settled two-turn exchange: enough to judge rhythm, gutters, and measure. */
const CONVERSATION: readonly ConciergeSessionEventWire[] = [
	prompt(1, 'Which of my projects have uncommitted work?'),
	answer(2, FIRST_ANSWER),
	event(3, { kind: 'status', previous: 'streaming', status: 'idle' }),
	prompt(4, 'Yes, do that.'),
	answer(5, SECOND_ANSWER),
	event(6, { kind: 'status', previous: 'streaming', status: 'idle' }),
];

/**
 * The same exchange with a live turn open on the end.
 *
 * Built per read rather than once at module scope, because the working
 * indicator counts up from the last prompt's timestamp: a fixed one would have
 * the scene open on an agent that has apparently been thinking since the epoch.
 * @returns The transcript, with its live turn starting now.
 */
function streamingTranscript(): readonly ConciergeSessionEventWire[] {
	const startedAt = new Date().toISOString();
	return [
		...CONVERSATION.slice(0, 3),
		{ ...prompt(4, 'Yes, do that.'), createdAt: startedAt },
		{
			...event(5, { kind: 'status', previous: 'idle', status: 'streaming' }),
			createdAt: startedAt,
		},
	];
}

/** Transcript per variant, so the scene switches by name rather than by array. */
const TRANSCRIPTS: Record<
	ConciergeFixtureTranscript,
	() => readonly ConciergeSessionEventWire[]
> = {
	conversation: () => CONVERSATION,
	empty: () => [],
	streaming: streamingTranscript,
};

/** Context readings: one calm, one past the mark that raises the clear banner. */
const PRESSURE: Record<'calm' | 'pressured', ConciergeContextPressureWire> = {
	calm: {
		maxTokens: 1_000_000,
		overThreshold: false,
		percent: 12,
		thresholdPercent: 80,
		usedTokens: 122_400,
	},
	pressured: {
		maxTokens: 1_000_000,
		overThreshold: true,
		percent: 86,
		thresholdPercent: 80,
		usedTokens: 861_000,
	},
};

/** What the fixture bridge is currently answering with. */
const state = {
	dictation: false,
	pressured: false,
	transcript: 'conversation' as ConciergeFixtureTranscript,
};

/**
 * Turns dictation on for the scene, which is the only way to see the composer's
 * control row at its most crowded: the mic shows only when the setting is on
 * *and* a key is stored, so a docked panel with dictation, an MCP roster, and a
 * long Claude Code model name is the width case worth judging.
 * @param enabled - Whether the mic control should be offered.
 */
export function setConciergeFixtureDictation(enabled: boolean): void {
	state.dictation = enabled;
}

/**
 * Points the fixture bridge at a different transcript. The scene invalidates the
 * transcript query afterwards; nothing here pushes, because the shipped hook
 * subscribes to broadcasts rather than polling.
 * @param transcript - Which staged transcript to answer with.
 */
export function setConciergeFixtureTranscript(
	transcript: ConciergeFixtureTranscript,
): void {
	state.transcript = transcript;
}

/**
 * Puts the fixture context reading over or under its high-water mark.
 * @param pressured - True to answer with a reading that raises the clear banner.
 */
export function setConciergeFixturePressure(pressured: boolean): void {
	state.pressured = pressured;
}

/** The session snapshot every open and clear hands back. */
const SESSION: ConciergeSessionSnapshotWire = {
	closedAt: null,
	createdAt: new Date(EPOCH).toISOString(),
	cwd: CONCIERGE_CWD,
	id: CONCIERGE_SESSION_ID,
	lastError: null,
	model: 'claude-opus-5',
	provider: 'pi',
	runtimeOpen: true,
	status: 'idle',
	thinkingLevel: 'think',
	title: 'Concierge',
	updatedAt: new Date(EPOCH).toISOString(),
};

/** Answers the App settings mirror, with dictation set as the scene asked. */
export function resolveFixtureAppSettings(): AppSettings {
	return {
		...DEFAULT_APP_SETTINGS,
		dictation: { ...DEFAULT_APP_SETTINGS.dictation, enabled: state.dictation },
	};
}

/** Answers the stored-key probe the mic control is gated on. */
export function resolveFixtureDictationKeyStatus(): DictationKeyStatus {
	return {
		configured: state.dictation,
		failure: null,
		maskedKey: 'sk-…f4c1',
		updatedAt: new Date(EPOCH).toISOString(),
	};
}

/** Answers the model catalogue the Concierge's two pickers are built from. */
export function resolveFixtureAgentModels(): AgentModelCatalog {
	return MODEL_CATALOG;
}

/** Answers the session open with a fixed, always-ready Concierge. */
export function resolveFixtureConciergeSession(): OpenConciergeSessionResult {
	return { session: SESSION };
}

/** Answers the transcript read with whichever variant the scene selected. */
export function resolveFixtureConciergeEvents(): ListConciergeEventsResult {
	return { events: TRANSCRIPTS[state.transcript]() };
}

/** Answers the context gauge and the clear banner's trigger. */
export function resolveFixtureConciergePressure(): ConciergeContextPressureWire {
	return state.pressured ? PRESSURE.pressured : PRESSURE.calm;
}

/** Accepts a send without running one, so the composer clears as it would. */
export function resolveFixtureConciergeSubmit(): SubmitConciergePromptResult {
	return { acceptedAt: new Date(EPOCH).toISOString() };
}

/** Accepts a stop, which the scene reflects by selecting a settled transcript. */
export function resolveFixtureConciergeStop(): StopConciergeSessionResult {
	return { ok: true };
}

/** Accepts a clear and hands the same session back, as a real clear would. */
export function resolveFixtureConciergeClear(): ClearConciergeContextResult {
	return { memoryPassRan: true, session: SESSION };
}

/**
 * Answers the app-wide tab listing the Concierge's `@` menu ranks against.
 *
 * Empty rather than staged: the menu also reads the shell's project list, which
 * the playground has no route to provide, so a tab here would rank under a
 * workspace name the scene cannot show. What it does buy is a resolved promise —
 * the blanket bridge no-op resolves `undefined`, which React Query rejects.
 */
export function resolveFixtureAllChatTabs(): ListAllChatTabsResult {
	return { closed: [], open: [] };
}

/** The transcript broadcast, which no fixture pushes into. */
export function registerFixtureConciergeEvents(): () => void {
	return () => undefined;
}
