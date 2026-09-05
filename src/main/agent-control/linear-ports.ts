/**
 * The {@link LinearPort} over the existing Linear data service.
 *
 * Kept out of `port-adapters.ts` for the same reason `review-ports.ts` is: this
 * is not thin delegation. Three things happen here that belong to no other
 * caller of the Linear service — the wire shapes are flattened into the few
 * fields an agent acts on, every payload is fitted to the agent budget and says
 * what it cut, and a state change into a Done or Canceled column is refused
 * before it reaches Linear. The service itself stays unaware that an agent is
 * one of its callers.
 *
 * Nothing here throws. The service already answers with a typed failure envelope
 * rather than an exception, and this module maps that envelope onto the one
 * `status` word an agent branches on.
 */

import type {
	AgentLinearComment,
	AgentLinearIssue,
	AgentLinearIssueDetail,
	AgentLinearResource,
	AgentLinearViewer,
	LinearAccountRef,
	LinearAgentStatus,
	LinearCreateCommentResult,
	LinearCreateIssueResult,
	LinearGetIssueResult,
	LinearGetMetadataResult,
	LinearListIssuesResult,
	LinearUpdateIssueResult,
} from '../../shared/agent-control.ts';
import {
	LINEAR_AGENT_LIMITS,
	LINEAR_INITIAL_STATE_TYPES,
	LINEAR_TERMINAL_STATE_TYPES,
	MAX_AGENT_PAYLOAD_CHARS,
} from '../../shared/agent-control.ts';
import type {
	GetLinearMetadataResult,
	LinearAccountFailure,
	LinearCommentWire,
	LinearIssueWire,
	LinearMetadataWire,
	LinearResourceWire,
	LinearServiceFailure,
	MutateLinearIssueResult,
} from '../../shared/ipc/contracts/linear.ts';
import type { LinearService } from '../linear';
import type { EnsemblrDatabaseService } from '../storage';
import { fitRows } from './payload-fit.ts';
import type { LinearPort } from './ports.ts';
import { readWorkspaceLinkedIssue } from './workspace-linked-issue.ts';

/** Collaborators the Linear port delegates to. */
export interface LinearPortDeps {
	/** Reads the calling workspace's linked issue, for the default account. */
	databaseService: EnsemblrDatabaseService;
	/**
	 * Names the connected accounts so a failed op can hand the agent the choice
	 * it could not make for itself. Returns an empty list when Linear is not
	 * composed into this build.
	 */
	listLinearAccounts: () => Promise<readonly LinearAccountRef[]>;
	/**
	 * The app's Linear service, or null when the app was composed without one.
	 * Nullable so a build that omits the integration answers `not-connected`
	 * rather than crashing the control op with an undefined read.
	 */
	linearService: LinearService | null;
}

/** State types an agent may never move an issue into, for a fast membership test. */
const TERMINAL_STATE_TYPES: ReadonlySet<string> = new Set(
	LINEAR_TERMINAL_STATE_TYPES,
);

/** State types a filed issue may open in, for a fast membership test. */
const INITIAL_STATE_TYPES: ReadonlySet<string> = new Set(
	LINEAR_INITIAL_STATE_TYPES,
);

// The refusal message is assembled after `fitMetadata` has spent the payload
// budget, so its state list is the one part of a Linear result that is not
// bounded by `MAX_AGENT_PAYLOAD_CHARS`. A team with dozens of workflow states is
// unusual but not impossible, and the agent only needs enough to pick one.
const MAX_LISTED_STATES = 12;

const NOT_CONNECTED_MESSAGE =
	'Linear is not connected. The user connects it in Settings → Integrations; nothing you can pass will change this, so say so rather than retrying.';

/**
 * Maps the service's failure code onto the word an agent branches on.
 * `reconnect-required` folds into `not-connected` because the recovery is
 * identical — the user reauthorizes — and a second word for one action only
 * invites a model to handle one and not the other.
 * @param failure - The service's typed failure envelope.
 * @returns The agent-facing status.
 */
function statusFor(failure: LinearServiceFailure): LinearAgentStatus {
	if (
		failure.code === 'not-connected' ||
		failure.code === 'reconnect-required'
	) {
		return 'not-connected';
	}
	return failure.code === 'not-found' ? 'not-found' : 'failed';
}

/**
 * Names what to do about each failure Linear's API reports, because the one thing
 * these codes have in common is that retrying the identical call is wrong for all
 * but one of them. Without a clause per code a model reads `Linear failed (…)` and
 * reaches for the same call again — immediately for a rate limit that wanted a
 * wait, and repeatedly for a permission error only the user can clear.
 * @param failure - The service's typed failure envelope.
 * @returns The recovery clause to append, empty for a code with nothing useful to add.
 */
function recoveryFor(failure: LinearServiceFailure): string {
	switch (failure.code) {
		case 'rate-limited':
			return failure.retryAfterSeconds === null
				? ' Linear is rate-limiting this token and did not say for how long. Get on with the rest of the work and try once more later in the turn, rather than retrying in a loop.'
				: ` Wait ${failure.retryAfterSeconds}s before trying again; a retry inside that window is refused the same way.`;
		case 'permission-denied':
			return " The connected Linear account is not allowed to do this — its OAuth scopes or the team's own permissions forbid it. Nothing you pass will change that, so do not retry: name the refused call in your reply and let the user widen the connection in Settings → Integrations.";
		case 'invalid-request':
			return ' Linear rejected the arguments rather than failing to reach them, so the identical call fails identically. Re-read the ids with ensemblr_linear_get_metadata — an id belonging to another account is the usual cause — before trying again.';
		case 'network':
			return ' Linear could not be reached. One retry is reasonable; a second failure means the network is down rather than flaky, so report it instead of looping.';
		default:
			return '';
	}
}

/**
 * Renders the prose an agent reads on a failure, naming the recovery rather than
 * only the fault.
 * @param failure - The service's typed failure envelope.
 * @param status - The agent-facing status the failure mapped to.
 * @returns The message to carry on the result.
 */
function messageFor(
	failure: LinearServiceFailure,
	status: LinearAgentStatus,
): string {
	if (status === 'not-connected') {
		return NOT_CONNECTED_MESSAGE;
	}
	if (status === 'not-found') {
		return `Linear could not find something this call named: ${failure.message} An issue id or identifier is the usual cause — check it, or search with ensemblr_linear_list_issues. A stateId, assigneeId, or teamId misses the same way, and each is valid only in the account that issued it, so re-read them with ensemblr_linear_get_metadata under the right accountId.`;
	}
	return `Linear failed (${failure.code}): ${failure.message}${recoveryFor(failure)}`;
}

/** The outcome fields every failed Linear op reports. */
function failed(failure: LinearServiceFailure): {
	status: LinearAgentStatus;
	message: string;
} {
	const status = statusFor(failure);
	return { message: messageFor(failure, status), status };
}

/** The outcome fields a Linear op reports when the app has no Linear service. */
function unavailable(): { status: LinearAgentStatus; message: string } {
	return { message: NOT_CONNECTED_MESSAGE, status: 'not-connected' };
}

/**
 * Cuts text to a budget and says so in place, because a description silently
 * shortened reads as the whole thing and an agent will quote it back as such.
 * @param text - The text to fit.
 * @param budget - Characters the text may occupy, marker excluded.
 * @returns The text at or under budget, marked when anything was cut.
 */
function clampText(text: string, budget: number): string {
	return text.length <= budget
		? text
		: `${text.slice(0, budget).trimEnd()}\n\n… shortened to ${budget} characters. Open the issue in Linear for the rest.`;
}

/**
 * Renders the sentence that owns up to a cut payload. Named counts rather than a
 * bare flag: a model acts on "narrow it" far more reliably than on `truncated`.
 * @param omitted - How many rows were dropped.
 * @param noun - What the dropped rows are, e.g. `issue`.
 * @param recovery - The call or argument that recovers them.
 * @returns The sentence to append, or an empty string when nothing was cut.
 */
function truncationNote(
	omitted: number,
	noun: string,
	recovery: string,
): string {
	return omitted === 0
		? ''
		: ` ${omitted} ${noun}(s) were dropped to fit the payload budget — ${recovery}`;
}

/** Flattens a wire issue into the fields an agent acts on. */
function toAgentIssue(issue: LinearIssueWire): AgentLinearIssue {
	return {
		accountId: issue.accountId,
		assignee: issue.assigneeName,
		assigneeId: issue.assigneeId,
		id: issue.id,
		identifier: issue.identifier,
		organization: issue.organizationName,
		priority: issue.priority,
		project: issue.projectName,
		state: issue.stateName,
		stateId: issue.stateId,
		stateType: issue.stateType,
		team: issue.teamName,
		title: issue.title,
		updatedAt: issue.updatedAt,
		url: issue.url,
	};
}

/** Flattens a wire issue for a single-issue read, description and labels included. */
function toAgentIssueDetail(issue: LinearIssueWire): AgentLinearIssueDetail {
	return {
		...toAgentIssue(issue),
		cycle: issue.cycleName,
		description: issue.description
			? clampText(
					issue.description,
					LINEAR_AGENT_LIMITS.maxReturnedDescriptionChars,
				)
			: null,
		labels: issue.labels.map((label) => label.name),
	};
}

/** Flattens a wire comment, clamping a body that would crowd out the rest. */
function toAgentComment(comment: LinearCommentWire): AgentLinearComment {
	return {
		author: comment.authorName,
		body: clampText(comment.body, LINEAR_AGENT_LIMITS.maxReturnedCommentChars),
		createdAt: comment.createdAt,
	};
}

/** Whether the returned-comment cap would cut this body. */
function commentWasClamped(comment: LinearCommentWire): boolean {
	return comment.body.length > LINEAR_AGENT_LIMITS.maxReturnedCommentChars;
}

/** Whether the returned-description cap would cut this issue's description. */
function descriptionWasClamped(issue: LinearIssueWire): boolean {
	return (
		issue.description !== null &&
		issue.description.length > LINEAR_AGENT_LIMITS.maxReturnedDescriptionChars
	);
}

/**
 * Fits an issue's comment thread into what the budget leaves after the issue
 * itself, newest first, then restores chronological order. Newest-first is the
 * selection order rather than the returned one: the recent exchange is what an
 * agent needs, but a thread handed back out of sequence reads as a conversation
 * that never happened.
 * @param comments - The thread as Linear returned it, oldest first.
 * @param issue - The issue already committed to the payload, for its cost.
 * @returns The comments that fit, in order, how many were dropped, and whether
 * any body that survived was itself cut.
 */
function fitComments(
	comments: readonly LinearCommentWire[],
	issue: AgentLinearIssueDetail,
): {
	kept: readonly AgentLinearComment[];
	omitted: number;
	clamped: boolean;
} {
	const newestFirst = [...comments]
		.reverse()
		.slice(0, LINEAR_AGENT_LIMITS.maxReturnedComments);
	const fitted = fitRows(
		newestFirst.map(toAgentComment),
		MAX_AGENT_PAYLOAD_CHARS - JSON.stringify(issue).length,
	);
	return {
		clamped: newestFirst.slice(0, fitted.kept.length).some(commentWasClamped),
		kept: [...fitted.kept].reverse(),
		omitted: comments.length - fitted.kept.length,
	};
}

/** Flattens a wire metadata row into the id, name, and two qualifiers an agent uses. */
function toAgentResource(resource: LinearResourceWire): AgentLinearResource {
	return {
		accountId: resource.accountId,
		id: resource.id,
		key: resource.key,
		name: resource.name,
		teamId: resource.teamId,
		type: resource.type,
	};
}

/**
 * The metadata kinds an agent receives, in the order the budget fills them.
 * States and teams come first because an update cannot be written without them;
 * cycles are absent because no op on this surface sets one.
 */
const METADATA_KINDS = [
	'states',
	'teams',
	'users',
	'projects',
	'labels',
] as const;

/** One metadata kind's flattened rows, keyed the way the result carries them. */
type MetadataRows = Record<
	(typeof METADATA_KINDS)[number],
	readonly AgentLinearResource[]
>;

/**
 * Fits every metadata kind into one shared budget, in priority order, so a
 * workspace with hundreds of labels cannot crowd out the states an update needs.
 * @param metadata - The cached metadata as the service returned it.
 * @returns The rows that fit, per kind, and how many were dropped in total.
 */
function fitMetadata(metadata: LinearMetadataWire): {
	rows: MetadataRows;
	omitted: number;
} {
	const rows = {} as Record<
		(typeof METADATA_KINDS)[number],
		readonly AgentLinearResource[]
	>;
	let remaining = MAX_AGENT_PAYLOAD_CHARS;
	let omitted = 0;
	for (const kind of METADATA_KINDS) {
		const fitted = fitRows(metadata[kind].map(toAgentResource), remaining);
		rows[kind] = fitted.kept;
		remaining -= fitted.spent;
		omitted += fitted.omitted;
	}
	return { omitted, rows };
}

/** The empty metadata result body, for the paths that have no rows to report. */
const NO_METADATA_ROWS: MetadataRows = {
	labels: [],
	projects: [],
	states: [],
	teams: [],
	users: [],
};

/**
 * Names why a state could not be classified: the id matched no cached row, the
 * row that matched carries no workflow type, or Linear could not be reached to
 * read the states at all.
 * @param metadata - The metadata read the lookup ran against.
 * @param state - The row the id matched, absent when it matched nothing.
 * @returns The clause the refusal states its cause with.
 */
function unclassifiableCause(
	metadata: GetLinearMetadataResult,
	state: LinearResourceWire | undefined,
): string {
	if (state) {
		return `the cached row for "${state.name}" carries no workflow type`;
	}
	return metadata.status === 'error'
		? `Linear could not be reached to check it (${metadata.failure.message})`
		: 'no cached workflow state has that id';
}

/**
 * States the refused update could have named instead, drawn from the same team as
 * the state it did name. A refusal that only says "call get_metadata" costs the
 * agent a round trip it does not need — the classification already read every
 * state in that team, so the alternatives are in hand.
 * @param states - Every cached workflow state the lookup covered.
 * @param target - The refused state, whose team scopes the alternatives.
 * @returns The clause naming the states that are allowed, or an empty string when none are.
 */
function nonTerminalStatesNote(
	states: readonly LinearResourceWire[],
	target: LinearResourceWire,
): string {
	const allowed = states.flatMap((row) =>
		row.teamId === target.teamId &&
		row.type !== null &&
		!TERMINAL_STATE_TYPES.has(row.type)
			? [`"${row.name}" (${row.id})`]
			: [],
	);
	if (allowed.length === 0) {
		return '';
	}
	const listed = allowed.slice(0, MAX_LISTED_STATES);
	const rest =
		allowed.length > listed.length
			? ` (${allowed.length - listed.length} more; call \`ensemblr_linear_get_metadata\` for the rest)`
			: '';
	return ` The states you may move it into on that team are ${listed.join(', ')}${rest}.`;
}

/**
 * Says that a refused update changed nothing at all. An agent that passed a title
 * alongside the state otherwise assumes the title landed and the state did not,
 * and never re-sends it.
 */
const NOTHING_APPLIED =
	'Nothing in this call was applied — not the state, and not any other field you passed alongside it, so re-send those on their own if you still want them.';

/**
 * Reports why an agent may not move an issue into a state, or null when it may.
 *
 * Fails closed on purpose. A state the cached metadata cannot classify might be
 * a Done column, and the whole point of the guard is that the app never posts an
 * agent's "finished" to a tracker the team reads — so an unclassifiable state is
 * refused with the one call that resolves it rather than passed through on the
 * assumption it is harmless. A row found without a `type` is as unclassifiable as
 * an id that matched nothing, and takes the same refusal.
 * @param service - The Linear service the states are read from.
 * @param stateId - The workflow state the update would move the issue into.
 * @param accountId - Account the agent named, narrowing the state lookup; when absent the lookup spans every account, because a state id is a UUID that identifies its account on its own.
 * @returns The model-facing refusal, or null when the state is not terminal.
 */
async function terminalStateRefusal(
	service: LinearService,
	stateId: string,
	accountId: string | undefined,
): Promise<string | null> {
	const metadata = await service.getMetadata(
		accountId ? { accountId } : undefined,
	);
	const states = metadata.metadata.states;
	const state = states.find((row) => row.id === stateId);
	if (!state || state.type === null) {
		return `Refused: this app will not move an issue into a state it cannot classify, and ${unclassifiableCause(metadata, state)}. Call ensemblr_linear_get_metadata and pass a state id from the list it returns. ${NOTHING_APPLIED}`;
	}
	if (TERMINAL_STATE_TYPES.has(state.type)) {
		return `Refused: "${state.name}" is a ${state.type} state, and agent work never closes a ticket here — marking it canceled is the same call under a different label. Move it to In Review instead and say in your reply that it is ready; the user decides whether it is done.${nonTerminalStatesNote(states, state)} ${NOTHING_APPLIED}`;
	}
	return null;
}

/**
 * Says that a refused create filed nothing at all, so an agent does not go
 * looking for a half-made issue or, worse, assume one exists and cite it.
 */
const NOTHING_CREATED =
	'Nothing was filed — there is no issue to find, edit, or delete, so fix the argument this names and call again.';

/**
 * States a refused create could have opened in, drawn from the target team. Same
 * argument as {@link nonTerminalStatesNote}: the classification already read
 * every state on that team, so making the agent call `get_metadata` again to
 * learn what it just looked at costs a round trip and buys nothing.
 * @param states - Every cached workflow state the lookup covered.
 * @param teamId - The team the issue is being filed on.
 * @returns The clause naming the states it may open in, or an empty string when none qualify.
 */
function initialStatesNote(
	states: readonly LinearResourceWire[],
	teamId: string,
): string {
	const allowed = states.flatMap((row) =>
		row.teamId === teamId &&
		row.type !== null &&
		INITIAL_STATE_TYPES.has(row.type)
			? [`"${row.name}" (${row.id})`]
			: [],
	);
	if (allowed.length === 0) {
		return ' That team exposes no backlog or triage state at all, so omit `stateId` and let Linear apply the team default.';
	}
	return ` The states you may open it in on that team are ${allowed
		.slice(0, MAX_LISTED_STATES)
		.join(
			', ',
		)} — or omit \`stateId\` entirely and let Linear apply the team default.`;
}

/**
 * Reports why an agent may not file this issue, or null when it may.
 *
 * Two refusals, both fail-closed, both checked against one metadata read. The
 * team must exist and must belong to the account the agent named, because a
 * ticket filed on the wrong board is invisible to the people who needed it and
 * cannot be moved from here. And an opening state must be one an unread ticket
 * belongs in: `started` claims someone is working on it, `completed` and
 * `canceled` close it before anyone has read it, and a state the cache cannot
 * classify might be any of the three.
 *
 * The metadata read is deliberately unscoped even when the agent named an
 * account: a team id is a UUID that identifies its own account, so reading only
 * the named account's tables would turn a mismatch into "no such team" and hide
 * the very thing the agent got wrong.
 * @param service - The Linear service the tables are read from.
 * @param args - The team, the account the agent named, and any opening state.
 * @returns The model-facing refusal, or null when the create may proceed.
 */
async function createIssueRefusal(
	service: LinearService,
	args: { accountId?: string; stateId?: string; teamId: string },
): Promise<string | null> {
	const metadata = await service.getMetadata();
	const team = metadata.metadata.teams.find((row) => row.id === args.teamId);
	if (!team) {
		return `Refused: no cached Linear team has the id "${args.teamId}"${
			metadata.status === 'error'
				? `, and Linear could not be reached to check for a newer one (${metadata.failure.message})`
				: ''
		}. Call ensemblr_linear_get_metadata with refresh: true and pass a teamId from the list it returns. ${NOTHING_CREATED}`;
	}
	if (args.accountId && team.accountId !== args.accountId) {
		return `Refused: team "${team.name}" belongs to Linear account "${team.accountId}", not to the "${args.accountId}" you passed. An id from one account is never valid in another, so this is a mismatch rather than something to retry — pass the team's own accountId, or drop accountId and let the team resolve it. ${NOTHING_CREATED}`;
	}
	if (!args.stateId) {
		return null;
	}
	const states = metadata.metadata.states;
	const state = states.find((row) => row.id === args.stateId);
	if (!state || state.type === null) {
		return `Refused: this app will not open an issue in a state it cannot classify, and ${unclassifiableCause(metadata, state)}. ${NOTHING_CREATED}${initialStatesNote(states, args.teamId)}`;
	}
	if (state.teamId !== null && state.teamId !== args.teamId) {
		return `Refused: "${state.name}" is a workflow state of another team, and a state is only valid on the team that owns it. ${NOTHING_CREATED}${initialStatesNote(states, args.teamId)}`;
	}
	if (!INITIAL_STATE_TYPES.has(state.type)) {
		return `Refused: "${state.name}" is a ${state.type} state, and a ticket you have just filed is not one anybody has read yet — opening it there tells the team work is underway, or finished, when neither is true. ${NOTHING_CREATED}${initialStatesNote(states, args.teamId)}`;
	}
	return null;
}

/**
 * Reports how a Linear issue mutation went, in the one shape both mutations
 * answer in. The two differ only in the sentence they describe success with, and
 * every part they share is load-bearing: a failure carries the account list an
 * agent needs to correct itself, and a success is flattened to the few fields it
 * acts on.
 * @param deps - Port collaborators, for the account list a failure carries.
 * @param result - The service's mutation envelope.
 * @param describe - Renders the success message from the issue as written.
 * @returns The agent-facing result for either mutation.
 */
async function issueMutationOutcome(
	deps: LinearPortDeps,
	result: MutateLinearIssueResult,
	describe: (issue: AgentLinearIssue) => string,
): Promise<LinearUpdateIssueResult> {
	if (result.status === 'error') {
		return {
			...failed(result.failure),
			...accountChoice(await listAccountsSafely(deps)),
			issue: null,
		};
	}
	const issue = toAgentIssue(result.issue);
	return { issue, message: describe(issue), status: 'ok' };
}

/**
 * Reads the Linear account a workspace was created against, so an agent working
 * a ticket does not have to name the organization it already came from.
 * @param deps - Port collaborators holding the database service.
 * @param workspaceId - Workspace the control op originated in.
 * @returns The linked issue's account id, or null when there is none.
 */
function workspaceAccountId(
	deps: LinearPortDeps,
	workspaceId: string,
): string | null {
	const linked = readWorkspaceLinkedIssue({
		databaseService: deps.databaseService,
		workspaceId,
	});
	return linked?.provider === 'linear' ? linked.accountId : null;
}

/**
 * Names the accounts a merged read could not finish, so a short list does not
 * read as a complete one.
 * @param failures - Per-account failures the service reported.
 * @returns The sentence to append, or an empty string when every account answered.
 */
function accountFailureNote(failures: readonly LinearAccountFailure[]): string {
	return failures.length === 0
		? ''
		: ` ${failures.length} account(s) could not be read (${failures
				.map(
					(entry) =>
						`${entry.organizationName ?? entry.accountId}: ${entry.failure.message}`,
				)
				.join('; ')}), so anything they hold is missing here.`;
}

/**
 * Attaches the account list to a failed outcome when more than one is connected.
 * A failure an agent can fix by naming an account is only actionable if it can
 * see which accounts exist.
 * @param accounts - Every connected account.
 * @returns The `accounts` field to spread onto the outcome, empty when moot.
 */
function accountChoice(accounts: readonly LinearAccountRef[]): {
	accounts?: readonly LinearAccountRef[];
} {
	return accounts.length > 1 ? { accounts } : {};
}

/**
 * Names the accounts a search actually covered. Saying "every connected account"
 * after narrowing to one invites the agent to conclude the others hold nothing.
 * @param accountId - Account the search was narrowed to, if any.
 * @returns The clause describing the scope that was searched.
 */
function searchScope(accountId: string | undefined): string {
	return accountId
		? `in Linear account "${accountId}"`
		: 'across every connected Linear account';
}

/**
 * Spreads a fallback account onto a service request, omitting the key entirely
 * when there is none so an `exactOptionalPropertyTypes` request never carries an
 * explicit undefined.
 * @param fallbackAccountId - Account to fall back to, if the workspace has one.
 * @returns The `fallbackAccountId` field to spread, empty when there is none.
 */
function withFallback(fallbackAccountId: string | undefined): {
	fallbackAccountId?: string;
} {
	return fallbackAccountId ? { fallbackAccountId } : {};
}

/**
 * Lists the connected accounts without ever throwing. Every caller here wants the
 * list as context on an answer it is already producing — the choice attached to a
 * failure, or the `viewer` rows on a metadata read — so an account lookup that
 * fails must degrade to an empty list rather than change how the op ends.
 * @param deps - Port collaborators holding the account lookup.
 * @returns The connected accounts, or an empty list when they cannot be read.
 */
async function listAccountsSafely(
	deps: LinearPortDeps,
): Promise<readonly LinearAccountRef[]> {
	return deps.listLinearAccounts().catch(() => []);
}

/**
 * Names who each account in a metadata read's scope is connected as, so an agent
 * taking a ticket on the user's behalf has a `userId` to assign it to instead of
 * matching display names against the users table.
 * @param accounts - Every connected account.
 * @param scope - The account the read was narrowed to, if any.
 * @returns The viewer rows for the accounts the read covered.
 */
function viewerRows(
	accounts: readonly LinearAccountRef[],
	scope: string | undefined,
): readonly AgentLinearViewer[] {
	return accounts.flatMap((account) =>
		!scope || account.accountId === scope
			? [
					{
						accountId: account.accountId,
						name: account.user,
						userId: account.userId,
					},
				]
			: [],
	);
}

/**
 * Builds the Linear port over the app's Linear data service.
 * @param deps - Port collaborators.
 * @returns The Linear port.
 */
export function makeLinearPort(deps: LinearPortDeps): LinearPort {
	const { linearService } = deps;

	/**
	 * The calling workspace's account, offered to the service as a *fallback*
	 * rather than a scope. ADR 0052 resolves the entity before the workspace, so
	 * passing this as `accountId` would let a workspace's organization silently
	 * win over the issue the agent actually named — and would skip the refusal an
	 * identifier matching two accounts is supposed to raise.
	 * @param workspaceId - Workspace the op originated in.
	 * @returns The workspace's account id, or undefined when it has none.
	 */
	function fallbackAccount(workspaceId: string): string | undefined {
		return workspaceAccountId(deps, workspaceId) ?? undefined;
	}

	return {
		readLinkedIssue: (workspaceId) =>
			readWorkspaceLinkedIssue({
				databaseService: deps.databaseService,
				workspaceId,
			}),

		// Deliberately not defaulted to the workspace's account: a search is the one
		// op where seeing every organization at once is the point, and an agent
		// that wants one narrows with `accountId`.
		listIssues: async ({ accountId, query, refresh, teamId }) => {
			if (!linearService) {
				return {
					...unavailable(),
					issues: [],
					omittedIssues: 0,
					source: null,
					truncated: false,
				} satisfies LinearListIssuesResult;
			}
			const result = await linearService.listIssues({
				...(accountId ? { accountId } : {}),
				query,
				refresh,
				teamId,
			});
			const fitted = fitRows(
				result.issues.map(toAgentIssue),
				MAX_AGENT_PAYLOAD_CHARS,
			);
			const cut = truncationNote(
				fitted.omitted,
				'issue',
				'narrow the search with `query`, `teamId`, or `accountId`.',
			);
			if (result.status === 'error') {
				const outcome = failed(result.failure);
				return {
					...accountChoice(await listAccountsSafely(deps)),
					issues: fitted.kept,
					message: `${outcome.message} The ${fitted.kept.length} issue(s) here are what the local cache already held.${cut}`,
					omittedIssues: fitted.omitted,
					source: null,
					status: outcome.status,
					truncated: fitted.omitted > 0,
				} satisfies LinearListIssuesResult;
			}
			const partial = accountFailureNote(result.accountFailures);
			return {
				issues: fitted.kept,
				message: `${fitted.kept.length} issue(s) ${searchScope(accountId)}, read from the ${result.source}. Descriptions are omitted here — read one with ensemblr_linear_get_issue.${cut}${partial}`,
				omittedIssues: fitted.omitted,
				source: result.source,
				status: 'ok',
				truncated: fitted.omitted > 0,
			} satisfies LinearListIssuesResult;
		},

		getIssue: async ({ accountId, issueId, refresh, workspaceId }) => {
			if (!linearService) {
				return {
					...unavailable(),
					comments: [],
					issue: null,
					omittedComments: 0,
					source: null,
					truncated: false,
				} satisfies LinearGetIssueResult;
			}
			const result = await linearService.getIssue({
				...(accountId ? { accountId } : {}),
				...withFallback(fallbackAccount(workspaceId)),
				id: issueId,
				refresh,
			});
			if (result.status === 'error') {
				return {
					...failed(result.failure),
					...accountChoice(await listAccountsSafely(deps)),
					comments: [],
					issue: null,
					omittedComments: 0,
					source: null,
					truncated: false,
				} satisfies LinearGetIssueResult;
			}
			const issue = toAgentIssueDetail(result.issue);
			const thread = fitComments(result.comments, issue);
			const cut = truncationNote(
				thread.omitted,
				'older comment',
				'open the issue in Linear to read the full thread.',
			);
			return {
				comments: thread.kept,
				issue,
				message: `${issue.identifier} "${issue.title}" is in ${issue.state ?? 'no state'}, read from the ${result.source}. It belongs to ${issue.organization ?? 'an unnamed organization'}, whose accountId is "${issue.accountId}" — pass that accountId on any write.${cut}`,
				omittedComments: thread.omitted,
				source: result.source,
				status: 'ok',
				truncated:
					thread.omitted > 0 ||
					thread.clamped ||
					descriptionWasClamped(result.issue),
			} satisfies LinearGetIssueResult;
		},

		getMetadata: async ({ accountId, refresh, workspaceId }) => {
			if (!linearService) {
				return {
					...unavailable(),
					...NO_METADATA_ROWS,
					omittedResources: 0,
					syncedAt: null,
					truncated: false,
					viewer: [],
				} satisfies LinearGetMetadataResult;
			}
			const scope = accountId ?? fallbackAccount(workspaceId);
			const [accounts, result] = await Promise.all([
				listAccountsSafely(deps),
				linearService.getMetadata({
					...(scope ? { accountId: scope } : {}),
					refresh,
				}),
			]);
			const fitted = fitMetadata(result.metadata);
			const cut = truncationNote(
				fitted.omitted,
				'row',
				'the states and teams an update needs are kept first; narrow with `accountId`.',
			);
			const viewer = viewerRows(accounts, scope);
			if (result.status === 'error') {
				const outcome = failed(result.failure);
				return {
					...fitted.rows,
					...accountChoice(accounts),
					message: `${outcome.message} The rows here are what the local cache already held.${cut}`,
					omittedResources: fitted.omitted,
					status: outcome.status,
					syncedAt: result.metadata.syncedAt,
					truncated: fitted.omitted > 0,
					viewer,
				} satisfies LinearGetMetadataResult;
			}
			const partial = accountFailureNote(result.accountFailures);
			return {
				...fitted.rows,
				message: `Teams, projects, workflow states, labels, and users, as synced at ${result.metadata.syncedAt ?? 'an unknown time'}. Every row names its accountId, and an id from one account is never valid in another. \`viewer\` names the Linear user each account is connected as — assign an issue to that \`userId\` when you take it on the user's behalf. Cycles are not returned — nothing on this surface sets one.${cut}${partial}`,
				omittedResources: fitted.omitted,
				status: 'ok',
				syncedAt: result.metadata.syncedAt,
				truncated: fitted.omitted > 0,
				viewer,
			} satisfies LinearGetMetadataResult;
		},

		createComment: async ({ accountId, commentBody, issueId, workspaceId }) => {
			if (!linearService) {
				return { ...unavailable(), commentId: null };
			}
			const result = await linearService.createComment({
				...(accountId ? { accountId } : {}),
				...withFallback(fallbackAccount(workspaceId)),
				body: commentBody,
				issueId,
			});
			if (result.status === 'error') {
				return {
					...failed(result.failure),
					...accountChoice(await listAccountsSafely(deps)),
					commentId: null,
				};
			}
			return {
				commentId: result.comment.id,
				message: `Comment posted on ${issueId}. It is visible to the whole team in Linear and cannot be edited or deleted from here.`,
				status: 'ok',
			} satisfies LinearCreateCommentResult;
		},

		createIssue: async ({
			accountId,
			assigneeId,
			description,
			labelIds,
			priority,
			projectId,
			stateId,
			teamId,
			title,
			workspaceId,
		}) => {
			if (!linearService) {
				return { ...unavailable(), issue: null };
			}
			const refusal = await createIssueRefusal(linearService, {
				...(accountId ? { accountId } : {}),
				...(stateId ? { stateId } : {}),
				teamId,
			});
			if (refusal) {
				return { issue: null, message: refusal, status: 'refused' };
			}
			const result = await linearService.createIssue({
				...(accountId ? { accountId } : {}),
				...withFallback(fallbackAccount(workspaceId)),
				...(assigneeId ? { assigneeId } : {}),
				...(description ? { description } : {}),
				...(labelIds ? { labelIds: [...labelIds] } : {}),
				...(priority === undefined ? {} : { priority }),
				...(projectId ? { projectId } : {}),
				...(stateId ? { stateId } : {}),
				teamId,
				title,
			});
			return issueMutationOutcome(
				deps,
				result,
				(issue) =>
					`Filed ${issue.identifier} "${issue.title}" on ${issue.team ?? 'the team you named'}, in ${issue.state ?? 'the team default state'}. The whole team sees it and nothing here can delete it, so cite ${issue.identifier} rather than filing it again. Its accountId is "${issue.accountId}" — pass that on any further write.`,
			) satisfies Promise<LinearCreateIssueResult>;
		},

		updateIssue: async ({
			accountId,
			assigneeId,
			description,
			issueId,
			priority,
			stateId,
			title,
			workspaceId,
		}) => {
			if (!linearService) {
				return { ...unavailable(), issue: null };
			}
			if (stateId) {
				const refusal = await terminalStateRefusal(
					linearService,
					stateId,
					accountId,
				);
				if (refusal) {
					return { issue: null, message: refusal, status: 'refused' };
				}
			}
			const result = await linearService.updateIssue({
				...(accountId ? { accountId } : {}),
				...withFallback(fallbackAccount(workspaceId)),
				id: issueId,
				input: { assigneeId, description, priority, stateId, title },
			});
			return issueMutationOutcome(
				deps,
				result,
				(issue) =>
					`${issue.identifier} updated; it is now in ${issue.state ?? 'no state'}.`,
			);
		},
	};
}
