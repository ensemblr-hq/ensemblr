/**
 * Ports the agent-control service delegates to. Each port is a narrow interface
 * over an existing main-process service, so the service stays decoupled and
 * unit-testable; concrete adapters wire these to the real chat-tab, Pi session,
 * terminal, script, and harness services at composition time.
 */
import type {
	AddDiffCommentsResult,
	AgentControlConversationStatus,
	AgentControlModelList,
	AgentControlProjectInfo,
	AgentControlRunScriptList,
	AgentControlTabInfo,
	AgentControlTerminalInfo,
	AgentControlWorkspaceInfo,
	AgentDiffComment,
	AskUserQuestionItem,
	AskUserQuestionResult,
	CreatedWorkspaceResult,
	ExitPlanModeArgs,
	ExitPlanModeResult,
	FocusPanelName,
	GetDiffCommentsResult,
	GetWorkspaceDiffResult,
	LinearCreateCommentArgs,
	LinearCreateCommentResult,
	LinearCreateIssueArgs,
	LinearCreateIssueResult,
	LinearGetIssueArgs,
	LinearGetIssueResult,
	LinearGetMetadataArgs,
	LinearGetMetadataResult,
	LinearListIssuesArgs,
	LinearListIssuesResult,
	LinearUpdateIssueArgs,
	LinearUpdateIssueResult,
	OpenTabVariant,
	ReadArchitectureDiagramOutcome,
	ReadConversationArgs,
	ReadConversationResult,
	RecallMemoryResult,
	ResolveDiffCommentsResult,
	SessionBriefNaming,
	SetBranchNameResult,
	SetSummaryResult,
	StartTerminalKind,
	SubagentMechanism,
	UpdateArchitectureDiagramOutcome,
	WorkspaceBoardStatusValue,
	WorkspaceLinkedIssue,
} from '../../shared/agent-control.ts';
import type { AgentProviderId } from '../../shared/agent-provider.ts';
import type { AppLanguage } from '../../shared/i18n.ts';
import type { PermissionMode } from '../../shared/permissions.ts';

/**
 * Which agent runtime a control command originated from. `pi` and `claude` are
 * first-class runtimes driving a native chat tab; `harness` is a third-party CLI
 * (Claude Code, Codex, Vibe) launched into a terminal tab over MCP.
 */
export type AgentSpecies = 'pi' | 'claude' | 'harness';

/**
 * Runtimes that drive a native Ensemblr chat tab. The chat-tab ops key off
 * membership here rather than off one runtime's name, so adding a runtime is a
 * matter of declaring what surface it has instead of revisiting every gate.
 */
const CHAT_TAB_SPECIES: ReadonlySet<AgentSpecies> = new Set(['pi', 'claude']);

/**
 * Identity of an agent being spawned, resolved into a control-env overlay. Chat
 * sessions pass their real per-session id and the spawning session's id so
 * lineage (depth, deadlock) guardrails work; harness/terminal launches pass a
 * workspace-scoped id with `species: 'harness'`.
 */
export interface AgentControlEnvIdentity {
	workspaceId: string;
	sessionId: string;
	parentSessionId?: string | null;
	species?: AgentSpecies;
	/**
	 * Registers the app-level Concierge, which belongs to no workspace and works
	 * out of its own home instead. Its `workspaceId` is empty, so the cwd every
	 * other caller resolves from that id is resolved from the concierge home.
	 */
	concierge?: boolean;
	/**
	 * Which delegation mechanism the session is opening under. Resolved by the
	 * caller and pinned here rather than read per request, so the tool list the
	 * control server serves cannot drift from the deny list the runtime fixed at
	 * session open. Defaults to `ensemblr` for a caller that does not say.
	 */
	delegation?: SubagentMechanism;
}

/**
 * Resolves the agent-control env overlay (control-server URL + a freshly minted
 * per-session token) for a spawning agent. Registers the origin as a side
 * effect. Returns an empty object when the control layer is unavailable.
 */
export type AgentControlEnvResolver = (
	identity: AgentControlEnvIdentity,
) => Record<string, string>;

/**
 * Resolved, trusted identity of a control command's caller. Minted at agent
 * spawn and looked up from the injected token; never assembled from
 * agent-supplied fields. Drives scope, permission mode, and lineage guardrails.
 */
export interface AgentControlOrigin {
	token: string;
	sessionId: string;
	/**
	 * Workspace every write is scoped to — empty for the Concierge, which has
	 * none. That is why every workspace-addressed op takes an optional
	 * `workspaceId`: a Concierge naming none is refused rather than defaulted
	 * into a workspace it does not have.
	 */
	workspaceId: string;
	/**
	 * True for the app-level Concierge, which reads and acts across every
	 * workspace instead of being confined to one. It outranks lineage: a
	 * Concierge is never an orchestrator or a sub-agent.
	 */
	concierge: boolean;
	/**
	 * True once a clear has replaced this Concierge conversation and left the
	 * child running only to write its memories. The token stays live for that
	 * turn, so the flag is what narrows it: nothing the child does from here
	 * reaches a surface the user is looking at.
	 */
	retired: boolean;
	workspaceCwd: string;
	parentSessionId: string | null;
	depth: number;
	species: AgentSpecies;
	delegation: SubagentMechanism;
}

/**
 * Whether the caller drives a native chat tab, which is what every chat-tab op
 * — naming the tab, recording its summary, questioning the user, Plan Mode —
 * actually depends on. A harness owns a terminal tab that titles itself from its
 * own session log, so there is no tab there to name, summarize, host a dialog,
 * or post a plan into.
 * @param origin - Resolved caller identity.
 * @returns True when the caller has a native chat tab.
 */
export function originHasChatTab(origin: AgentControlOrigin): boolean {
	return CHAT_TAB_SPECIES.has(origin.species);
}

/**
 * The agent runtime a caller is itself running on, which is the axis a spawned
 * child may not cross. `pi` and `claude` name a runtime directly; a harness
 * resolves to null, because its control origin is minted per workspace and
 * shared by every terminal in it — the app cannot tell a Claude Code CLI from a
 * Codex one, let alone from a bare shell, once the token is in the environment.
 * @param origin - Resolved caller identity.
 * @returns The caller's runtime, or null when it has none the app can name.
 */
export function originRuntime(
	origin: AgentControlOrigin,
): AgentProviderId | null {
	return origin.species === 'harness' ? null : origin.species;
}

/** Lists the app's projects and workspaces for the cross-workspace read ops. */
export interface WorkspacePort {
	listProjects: () => Promise<readonly AgentControlProjectInfo[]>;
	listWorkspaces: () => Promise<readonly AgentControlWorkspaceInfo[]>;
}

/** Chat/terminal tab operations plus the reads needed to scope-check them. */
export interface TabPort {
	spawnChatTab: (input: {
		workspaceId: string;
		title?: string;
	}) => Promise<{ chatTabId: string }>;
	closeTab: (input: { chatTabId: string }) => Promise<void>;
	openNonChatTab: (input: {
		workspaceId: string;
		variant: OpenTabVariant;
		filePath?: string;
		turnId?: string;
		commentBody?: string;
		prNumber?: number;
	}) => Promise<{ chatTabId: string }>;
	listTabs: (input: {
		workspaceId: string;
	}) => Promise<readonly AgentControlTabInfo[]>;
	/** Owning workspace of a tab, or null when it does not exist. */
	resolveTabWorkspace: (chatTabId: string) => Promise<string | null>;
}

/**
 * What a spawn attempt produced. A model the spawn cannot honour — one from
 * another agent runtime, or none inferable at all — is a modelled refusal rather
 * than a thrown error: the calling agent can correct it on its next turn, and
 * the reason is prose written for it to read. Everything else that can go wrong
 * here (a runtime that will not start, a first prompt that fails) still rejects.
 */
export type StartConversationOutcome =
	| { ok: true; chatTabId: string; agentSessionId: string }
	| { ok: false; reason: string };

/** Agent conversation lifecycle plus its scope-check and read helpers. */
export interface ConversationPort {
	startConversation: (input: {
		workspaceId: string;
		workspaceCwd: string;
		chatTabId?: string;
		prompt: string;
		model?: string;
		thinkingLevel?: string;
		/** Descriptive name applied to the new conversation's tab via Pi `/name`. */
		title?: string;
		/**
		 * The model the caller's own runtime reports it is running now, forwarded by
		 * the Pi extension. Fresher than the caller's session row, so it is preferred
		 * when the catalog places it on the caller's runtime — and dropped entirely
		 * when it does not, so the forwarded value can never move a child across.
		 */
		callerModel?: string;
		/**
		 * The agent runtime the caller itself runs on, resolved from its control
		 * origin. The child is pinned to this runtime and an explicit `model` from
		 * another one is refused; null means the caller has no runtime the app can
		 * name, and the spawn fails unless it names a model outright.
		 */
		callerRuntime: AgentProviderId | null;
		/**
		 * Whether the app-level Concierge is the caller, carried across from its
		 * control origin because nothing downstream can infer it. Two readers, one
		 * fact: the child's lineage role comes from `spawnedChildRole`, so a
		 * Concierge's child is a root orchestrator and carries no sub-agent marker;
		 * and the caller's own model is read from the Concierge session service,
		 * which is the only store that holds it.
		 *
		 * Required rather than optional for the reason `planMode` is: a second spawn
		 * route that forgot it would silently produce sub-agents from a parent that
		 * can never have one.
		 */
		callerConcierge: boolean;
		/** Caller session id, threaded into the child's spawn env for lineage. */
		parentSessionId: string;
		/**
		 * Whether the child starts in Plan Mode, snapshotted from the spawning agent
		 * at spawn time; the child owns the flag afterwards. Required rather than
		 * optional so a future second spawn route cannot silently produce an
		 * unrestricted child from a planning parent.
		 */
		planMode: boolean;
	}) => Promise<StartConversationOutcome>;
	/**
	 * Lists the models the caller may spawn a child on — its own runtime's, or
	 * every runtime's when the caller has none the app can name.
	 */
	listModels: (input: {
		runtime: AgentProviderId | null;
	}) => Promise<AgentControlModelList>;
	sendFollowUp: (input: {
		agentSessionId: string;
		prompt: string;
	}) => Promise<void>;
	/**
	 * Sets the display name of an active conversation's tab (Pi `/name`).
	 * Resolves null when the session is not active, and `applied: false` when the
	 * user owns the title and the rename was declined.
	 */
	setName: (input: {
		agentSessionId: string;
		name: string;
	}) => Promise<{ applied: boolean; chatTabId: string; title: string } | null>;
	/**
	 * Resolves once the session goes idle, or `'timeout'` after `timeoutMs` — or
	 * as soon as `signal` aborts, since a caller that has gone is not waiting for
	 * the child any more.
	 */
	waitForIdle: (
		agentSessionId: string,
		timeoutMs: number,
		signal?: AbortSignal,
	) => Promise<'completed' | 'timeout'>;
	/**
	 * Live conversation status. Reads the in-memory snapshot only, with no
	 * persisted-event scan, so the `waitForAgents` poll loop can call it every
	 * tick; pair it with {@link ConversationPort.hasFinalMessage} when a caller
	 * needs the full {@link AgentControlConversationStatus}.
	 */
	getStatus: (
		agentSessionId: string,
	) => Promise<Omit<AgentControlConversationStatus, 'hasFinalMessage'> | null>;
	/**
	 * Whether a persisted assistant answer exists for the conversation. Scans
	 * stored events, so it stays off the poll loop and is resolved only for the
	 * callers that report the flag.
	 */
	hasFinalMessage: (agentSessionId: string) => Promise<boolean>;
	/**
	 * The conversation's report: every assistant message of its newest answered
	 * turn, joined, or null when it has produced none. A whole turn rather than a
	 * single message so an agent that signs off after its findings does not
	 * shadow them.
	 */
	getLastMessage: (agentSessionId: string) => Promise<string | null>;
	/**
	 * A page of the conversation's persisted transcript: its prompts, answers, and
	 * tool calls with arguments and results. Loads the branch's events, so it is a
	 * deliberate read rather than something a poll loop should reach for. An
	 * unknown session reads as an empty branch, which is what an auditor needs to
	 * tell "nothing happened" from "the tool failed".
	 */
	readTranscript: (
		args: ReadConversationArgs,
	) => Promise<ReadConversationResult>;
	/**
	 * Whether a Pi session's chat tab carries the sub-agent marker its spawn
	 * persisted. Role resolution needs a signal that outlives the process: a
	 * caller's `parentSessionId` is never stored, so a conversation resumed after
	 * a restart re-registers at depth 0, while its Plan Mode comes back from the
	 * renderer's per-tab store — lineage alone would hand a restored investigator
	 * the orchestrator policy. An implementation that cannot read the marker
	 * reports false rather than throwing, which leaves the role to depth exactly
	 * as it was before the marker existed.
	 */
	isSpawnedSubAgent: (agentSessionId: string) => Promise<boolean>;
	/** Owning workspace of a Pi session, or null when it does not exist. */
	resolveConversationWorkspace: (
		agentSessionId: string,
	) => Promise<string | null>;
}

/**
 * A dock terminal that started, or the lifecycle diagnostic explaining why none
 * did. A script launch fails for ordinary, correctable reasons — a run script
 * named that the repository does not configure, another one already up — and the
 * caller has to read them, so the failure travels rather than collapsing into an
 * empty terminal id that reads as success.
 */
export type StartTerminalOutcome =
	| { ok: true; terminalId: string }
	| {
			ok: false;
			code: string;
			message: string;
			/** The session the refusal is about, when one already holds the slot. */
			terminalId?: string;
	  };

/** Dock terminal operations plus their scope-check and read helpers. */
export interface TerminalPort {
	startTerminal: (input: {
		workspaceId: string;
		workspaceCwd: string;
		kind: StartTerminalKind;
		/** Named run script to start; omitted starts the repository's default. */
		scriptName?: string;
		/** Replace a script of this kind that is already running. */
		restart?: boolean;
	}) => Promise<StartTerminalOutcome>;
	/** The run scripts the workspace's repository offers, in declaration order. */
	listRunScripts: (input: {
		workspaceId: string;
	}) => Promise<AgentControlRunScriptList>;
	stopTerminal: (input: {
		workspaceId: string;
		terminalId?: string;
		kind?: 'setup' | 'run';
	}) => Promise<void>;
	writeTerminal: (input: {
		terminalId: string;
		input: string;
	}) => Promise<void>;
	/**
	 * A terminal's scrollback, rendered readable unless `ansi` asks for the raw
	 * PTY bytes. Null when the terminal holds no output.
	 */
	readOutput: (input: {
		terminalId: string;
		ansi: boolean;
	}) => Promise<string | null>;
	listTerminals: (input: {
		workspaceId: string;
	}) => Promise<readonly AgentControlTerminalInfo[]>;
	/** Owning workspace of a terminal, or null when it does not exist. */
	resolveTerminalWorkspace: (terminalId: string) => Promise<string | null>;
}

/** Launches a third-party harness into a new terminal tab. */
export interface HarnessPort {
	launchHarness: (input: {
		workspaceId: string;
		harnessId: string;
		/** Caller session id, threaded into the child's spawn env for lineage. */
		parentSessionId: string;
	}) => Promise<{ chatTabId: string; terminalId: string }>;
}

/**
 * Brings a view to the foreground by broadcasting a focus request to the
 * renderer window showing the workspace. Focus is renderer state (active
 * tab/panel), so this is the only port that reaches back to the UI.
 */
export interface FocusPort {
	focusTab: (input: { workspaceId: string; chatTabId: string }) => void;
	focusDockTab: (input: { workspaceId: string; dock: string }) => void;
	focusPanel: (input: { workspaceId: string; panel: FocusPanelName }) => void;
	/**
	 * Navigates the app to a workspace. The other three bring a surface forward
	 * inside the workspace already on screen, which is enough for an agent that
	 * has only one; the Concierge spans every workspace, so it needs the route to
	 * move before any of them mean anything.
	 */
	focusWorkspace: (input: { workspaceId: string }) => void;
}

/**
 * Cuts a new workspace off a project and reports what it made.
 *
 * Concierge-only, and deliberately narrow: an agent that can create a worktree
 * and a branch is one that can spend disk and run a setup script, so the port
 * takes the project, the name, and an optional base branch — nothing that
 * reshapes the repository. Linking a Linear issue is deliberately absent: the
 * link needs the issue's identifier, title, and URL rather than its id, so
 * exposing it here would mean a Linear read inside the port for a field the
 * agent can set afterwards with `ensemblr_linear_update_issue`.
 *
 * The name is required here as well as at the boundary schema, because the
 * create service falls back to the literal placeholder `workspace` when handed
 * none — a worktree called "workspace" on `<prefix>/workspace` that the next one
 * collides with. Leaving it optional on the port would keep that hole open to
 * every future caller.
 */
export interface WorkspaceCreationPort {
	createWorkspace: (input: {
		baseBranch?: string;
		name: string;
		projectId: string;
	}) => Promise<CreatedWorkspaceResult>;
}

/**
 * Searches the Concierge's own memory index.
 *
 * Read-only by construction: memories are written as ordinary files under the
 * Concierge home and indexed by a watcher, so there is no write op here to keep
 * the file and the index in step.
 */
export interface MemoryPort {
	recall: (input: { limit?: number; query: string }) => RecallMemoryResult;
}

/**
 * Reads the Concierge's own state: where it lives, which is what its tool policy
 * admits or refuses every file write against, and what its open conversation is
 * running on, which is what a child it spawns inherits.
 */
export interface ConciergePort {
	homePath: () => string | null;
	/**
	 * The model and thinking level the open Concierge conversation runs on, or
	 * null when none is open. It exists because the Concierge keeps its own
	 * session store: `agentSessionService` holds no row for it, so the spawn path
	 * has nothing to inherit from without this and would fall through to the
	 * catalog default.
	 */
	describeSession: () => {
		model: string | null;
		thinkingLevel: string | null;
	} | null;
}

/**
 * Reads and writes a workspace's kanban board status. Writes broadcast to the
 * renderer (which owns the board-status atom) and update the main-side mirror
 * optimistically; reads serve from that mirror.
 */
export interface BoardPort {
	setWorkspaceStatus: (input: {
		workspaceId: string;
		status: WorkspaceBoardStatusValue;
	}) => void;
	getWorkspaceStatus: (workspaceId: string) => WorkspaceBoardStatusValue;
}

/**
 * Reads the workspace's own diff, scoped the way the Changes panel scopes it.
 * The port owns the whole assembly — resolving the base branch, composing the
 * status read with the per-file patches, and fitting the result to the payload
 * budget — so the service stays a dispatch and the git service stays unaware
 * that an agent is one of its callers.
 */
export interface DiffPort {
	readWorkspaceDiff: (input: {
		workspaceId: string;
		workspaceCwd: string;
		/** Read one file's patch whole instead of the budgeted whole-workspace diff. */
		file?: string;
		/** Return changed-file rows and totals only, issuing no per-file git calls. */
		stat?: boolean;
	}) => Promise<GetWorkspaceDiffResult>;
}

/**
 * Reads and writes the workspace's Ensemblr-local review comments — the ones
 * the Changes panel renders. Separate from {@link DiffPort} because it fronts
 * the review service and its SQLite store rather than git, and writes here are
 * bound to the caller's own workspace by construction: no member takes a
 * workspace argument the agent could point elsewhere.
 */
export interface ReviewPort {
	listComments: (input: {
		workspaceId: string;
		file?: string;
	}) => Promise<GetDiffCommentsResult>;
	addComments: (input: {
		workspaceId: string;
		comments: readonly AgentDiffComment[];
	}) => Promise<AddDiffCommentsResult>;
	resolveComments: (input: {
		workspaceId: string;
		commentIds: readonly string[];
	}) => Promise<ResolveDiffCommentsResult>;
}

/**
 * Reads and writes Linear issues over the service that already backs the
 * renderer's tracker views.
 *
 * The seam sits above that service rather than beside it because its two callers
 * want opposite things from the same rows. The renderer draws a board: it wants
 * every field, the typed failure envelope, and the cache-versus-remote provenance
 * that lets it badge a stale list. An agent wants a handful of flat rows it can
 * act on, one `status` word it can branch on, and a hard ceiling on what a single
 * read costs its context — and it must never be handed a route to close a ticket,
 * which this repository reserves for a human. Putting any of that in the shared
 * service would shape a renderer's data around an agent's budget, so the
 * flattening, the truncation, and the terminal-state guard live here.
 *
 * Nothing throws. Linear is unconnected in most workspaces and its API fails for
 * ordinary reasons, and an agent has to tell "no tracker" from "no such issue"
 * from "Linear is down" to do anything sensible — so every failure travels as a
 * `status` on the result rather than as an exception the service would flatten
 * into one `internal` code.
 *
 * Every member takes the calling workspace, and only for account resolution:
 * Linear is app-level, but several accounts can be connected at once, and a
 * workspace created from an issue already records which one it came from. That
 * is the default an agent should not have to be told. Nothing here reads or
 * writes workspace state beyond that lookup.
 */
export interface LinearPort {
	listIssues: (
		input: LinearPortInput<LinearListIssuesArgs>,
	) => Promise<LinearListIssuesResult>;
	getIssue: (
		input: LinearPortInput<LinearGetIssueArgs>,
	) => Promise<LinearGetIssueResult>;
	getMetadata: (
		input: LinearPortInput<LinearGetMetadataArgs>,
	) => Promise<LinearGetMetadataResult>;
	createComment: (
		input: LinearPortInput<LinearCreateCommentArgs>,
	) => Promise<LinearCreateCommentResult>;
	createIssue: (
		input: LinearPortInput<LinearCreateIssueArgs>,
	) => Promise<LinearCreateIssueResult>;
	updateIssue: (
		input: LinearPortInput<LinearUpdateIssueArgs>,
	) => Promise<LinearUpdateIssueResult>;
	/**
	 * Reads the issue a workspace was created from, for the linked-issue directive
	 * rather than for an op — no control op returns this, because the fact reaches
	 * the agent as a standing instruction on every turn instead of as something it
	 * has to think to ask for.
	 *
	 * Synchronous and local: it reads the workspace's own metadata row, never
	 * Linear, which is what makes it affordable on the per-turn path.
	 */
	readLinkedIssue: (workspaceId: string) => WorkspaceLinkedIssue | null;
}

/** An agent's Linear args plus the workspace whose linked account defaults them. */
export type LinearPortInput<T> = T & { workspaceId: string };

/**
 * Resolves the active permission mode. The mode is a global app setting (the
 * same value the IPC permission gate reads), so it takes no workspace argument.
 */
export interface PermissionPort {
	getMode: () => PermissionMode;
}

/**
 * Resolves the language the app renders in, so the playbooks an agent receives
 * can carry the directive that puts its prose in the same language. Like the
 * permission mode this is a global app setting, so it takes no workspace
 * argument, and it is read per call rather than captured because the user can
 * change it while sessions are live.
 */
export interface LanguagePort {
	getLanguage: () => AppLanguage;
}

/**
 * Reports whether the user opted into crediting Ensemblr as a commit co-author,
 * so the playbooks an agent receives can carry the trailer block. Like the
 * language and the permission mode this is a global app setting, so it takes no
 * workspace argument, and it is read per call rather than captured because the
 * user can toggle it while sessions are live.
 */
export interface CommitCreditPort {
	isCoAuthorEnabled: () => boolean;
}

/**
 * Surfaces a confirmation to the human when the mode requires approval. Returns
 * true when approved. Harnesses have no native confirm channel, so this drives
 * Ensemblr's own UI regardless of the caller's species.
 */
export interface ConfirmPort {
	confirm: (input: {
		origin: AgentControlOrigin;
		summary: string;
		/**
		 * Aborts when the caller goes away while the prompt is up. An
		 * implementation that cannot withdraw its dialog resolves false instead,
		 * which is what stops a late approval firing an op nobody is waiting for.
		 */
		signal?: AbortSignal;
	}) => Promise<boolean>;
}

/**
 * Puts an agent's questionnaire to the human and resolves once they answer or
 * dismiss it. The call blocks the agent's turn for as long as the dialog is up,
 * with no time limit, which is the point: the agent asked because it cannot
 * proceed without a decision, and a human is allowed to take their time.
 */
export interface AskPort {
	ask: (input: {
		origin: AgentControlOrigin;
		questions: readonly AskUserQuestionItem[];
		/** Withdraws the dialog when the asking turn ends before they answer. */
		signal?: AbortSignal;
	}) => Promise<AskUserQuestionResult>;
	/** Cancels every questionnaire still pending for a session that ended. */
	releaseSession: (sessionId: string) => void;
}

/**
 * Reads a session's Plan Mode state and hands its finished plan to the user.
 * `exit` returns as soon as the plan is saved and surfaced — it does not wait
 * for a decision, so the agent's turn ends with the plan as its last message.
 */
export interface PlanModePort {
	isActive: (sessionId: string) => boolean;
	exit: (input: {
		origin: AgentControlOrigin;
		args: ExitPlanModeArgs;
	}) => Promise<ExitPlanModeResult>;
	/**
	 * Puts a freshly spawned child into Plan Mode, so a planning parent's
	 * delegation stays read-only. Deliberately one-way: this port is reachable
	 * from every control handler, and a member that could turn Plan Mode *off*
	 * would be a route for a future op to unblock its own session, contradicting
	 * the promise the agent is given that only the user's approval ends planning.
	 */
	activateForSpawn: (sessionId: string) => void;
	/**
	 * Whether the session already handed a plan to the user, which makes this
	 * turn a refinement round it has to close with another submission.
	 */
	hasSubmittedPlan: (sessionId: string) => boolean;
	/** Forgets a session's Plan Mode state once it ends. */
	releaseSession: (sessionId: string) => void;
}

/**
 * Reads and writes the caller's own session identity: the per-turn upkeep
 * brief, the one-shot workspace/branch naming, and the tab's session summary.
 * Separate from {@link TabPort} (id plumbing for scope checks) and
 * {@link ConversationPort} (Pi lifecycle) because neither should grow workspace
 * metadata or git-rename responsibilities. Every operation resolves the
 * caller's tab and branch from its origin rather than taking them as arguments.
 */
export interface SessionNamingPort {
	/** Best-effort: an unresolvable caller reports nothing outstanding. */
	readBrief: (origin: AgentControlOrigin) => Promise<SessionBriefNaming>;
	/**
	 * One-shot naming of the workspace and its git branch. Gated on the user's
	 * "Let agents name the workspace and branch" setting as well as the
	 * placeholder-name check: with the setting off nothing is renamed and the
	 * result comes back `applied: false`, however insistently the agent asks.
	 */
	setBranchName: (input: {
		origin: AgentControlOrigin;
		slug: string;
		/** Whether the user asked for this rename, lifting the once-per-branch gate. */
		userRequested: boolean;
	}) => Promise<SetBranchNameResult>;
	setSummary: (input: {
		origin: AgentControlOrigin;
		title: string;
		summary: string;
	}) => Promise<SetSummaryResult>;
}

/**
 * Stores an agent-refined architecture diagram for the caller's workspace.
 *
 * The port is where the policy lives, not the handler: it validates the
 * submitted document against the shared IR schema, refuses one that exceeds
 * {@link ARCHITECTURE_DIAGRAM_LIMITS}, fits a read to
 * {@link MAX_AGENT_PAYLOAD_CHARS} and says what it cut, and answers with one
 * `reason` word rather than throwing across the boundary. Control adds no
 * capability of its own — the storage and the gates are the architecture
 * service's, and this only reaches them.
 */
export interface ArchitecturePort {
	/**
	 * Reads the workspace's stored diagram, answering with a null document for a
	 * workspace nobody has drawn. Nothing derives one, so that absence is an
	 * ordinary result rather than a failure.
	 */
	readDiagram: (input: {
		origin: AgentControlOrigin;
	}) => Promise<ReadArchitectureDiagramOutcome>;
	updateDiagram: (input: {
		diagram: unknown;
		origin: AgentControlOrigin;
	}) => Promise<UpdateArchitectureDiagramOutcome>;
}

/** All collaborators the agent-control service composes. */
export interface AgentControlPorts {
	ask: AskPort;
	planMode: PlanModePort;
	sessionNaming: SessionNamingPort;
	workspaces: WorkspacePort;
	tabs: TabPort;
	conversations: ConversationPort;
	terminals: TerminalPort;
	harnesses: HarnessPort;
	focus: FocusPort;
	board: BoardPort;
	/** Concierge-only; absent when the Concierge is not wired. */
	workspaceCreation?: WorkspaceCreationPort;
	/** Concierge-only; absent when the Concierge is not wired. */
	memory?: MemoryPort;
	/** Concierge-only; absent when the Concierge is not wired. */
	concierge?: ConciergePort;
	/** Absent when no architecture service is wired; the op is then refused. */
	architecture?: ArchitecturePort;
	diff: DiffPort;
	review: ReviewPort;
	linear: LinearPort;
	permissions: PermissionPort;
	language: LanguagePort;
	commitCredit: CommitCreditPort;
	confirm: ConfirmPort;
}
