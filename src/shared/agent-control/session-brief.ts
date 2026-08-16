/**
 * Renders the per-turn blocks appended to an agent's system prompt: the upkeep
 * block naming what the session still owes, and the directive a turn carries
 * when a plan it submitted is already in front of the user.
 *
 * The three naming tools are also described in the role playbooks, but a
 * playbook is static: a long skill invocation, or Plan Mode's instruction that
 * nothing else in context outranks it, reliably buries a standing "remember to
 * name your tab". This block is rebuilt from live state every turn, names only
 * what is still outstanding, and disappears entirely once nothing is — so it
 * stays legible without becoming noise.
 *
 * For the branch it is not just a reminder but the only instruction: the
 * `git.renameWorkspaceOnBranch` setting gates `ensemblr_set_branch_name`, and a
 * static playbook cannot see a setting, so the playbooks describe the tool and
 * defer to this block for whether to call it. An unconditional "name the branch"
 * in a playbook would order an opted-out user's agent to call a tool that
 * refuses it.
 *
 * The Plan Mode variant carries its own carve-out rather than relying on
 * `PLAN_MODE_UPKEEP_CLAUSE`. That clause lives in the Pi-only plan-mode
 * playbooks, so a runtime the app prompts directly — Claude Code, which learns
 * of Plan Mode only as the SDK's `permissionMode: 'plan'` — never sees it, and
 * reads its own "MUST NOT run any non-readonly tools" against a block asking for
 * three write ops. It resolves that in favour of the stronger instruction and
 * defers every name until after the plan is approved, which is the whole delay
 * this variant exists to close.
 *
 * It is rendered here, in the app, rather than in the shipped Pi extension. The
 * extension carries byte-identical copies of the playbooks because it cannot
 * import from `src/` at runtime, and a parity test polices them; a block built
 * from runtime state has no literal to compare, so the app ships the finished
 * string in the brief payload and the extension appends text it never authors.
 */

import type { SessionBriefNaming } from './contracts.ts';

/** Opening line of the upkeep block, and the marker tests assert on. */
export const SESSION_BRIEF_NUDGE_HEADER = 'ENSEMBLR SESSION UPKEEP';

/** Preamble framing the block as bookkeeping to fold into the turn silently. */
const NUDGE_PREAMBLE = `${SESSION_BRIEF_NUDGE_HEADER} — the app tracks this for you and raises only what is still outstanding. Fold these into this turn: no narration to the user, no asking permission. Each line disappears once its item is done.`;

/**
 * Preamble for a planning turn. States the carve-out in full because this is the
 * only place a directly-prompted runtime will read it, and states the timing
 * because planning is the case where deferring costs the most: the user watches
 * an unnamed workspace for the whole interview.
 */
const PLAN_MODE_NUDGE_PREAMBLE = `${SESSION_BRIEF_NUDGE_HEADER} — the app tracks this for you and raises only what is still outstanding. Fold these into this turn: no narration to the user, no asking permission. Each line disappears once its item is done.

You are planning, and every item below is still allowed. These are labelling calls: they name a tab and a workspace, they change no file, run no command, and are reversible. A restriction on non-read-only tools does not reach them, and nothing about planning defers them. Do them NOW, at the top of this turn, before you read the repository and before your first question — until you do, the board shows the user a workspace whose name says nothing about what it is doing, and planning is exactly when you already know what the work is called.`;

/** Bullet asking the agent to replace the prompt-derived tab title. */
const TITLE_BULLET =
	'- Tab title: this tab is still carrying a title derived from the prompt rather than chosen. Call `ensemblr_set_name` with `title` set to a short, specific label for what this conversation is actually about.';

/** The same bullet for a planning turn, with the timing it must not defer. */
const PLAN_MODE_TITLE_BULLET = `${TITLE_BULLET} Call it now, before your first question — the user is about to be interviewed and needs to know which tab is asking.`;

/** Bullet asking the agent to record what the turn covered. */
const SUMMARY_BULLET =
	"- Session summary: the summary on file for this tab is older than the conversation. Call `ensemblr_set_summary` once the work is done but BEFORE you write your closing answer to the user — prose you follow with another tool call gets folded into the turn's collapsed activity row. Pass a short `title` and a markdown `summary` covering the decisions made, the files touched, and what is still open. It replaces the record the app keeps for this tab; it does NOT rename the tab.";

/**
 * The same bullet for a planning turn. Retimed because the slot the standard
 * wording names does not exist here: a planning agent produces nothing after
 * `ensemblr_exit_plan_mode`, so "before your closing answer" leaves it nowhere
 * to put the call.
 */
const PLAN_MODE_SUMMARY_BULLET =
	'- Session summary: the summary on file for this tab is older than the conversation. Call `ensemblr_set_summary` as the last thing you do before `ensemblr_exit_plan_mode` — that tool ends your turn, so there is no slot after it — or before your closing message on a turn where you are not submitting a plan. Pass a short `title` and a markdown `summary` covering the decisions made, what the plan settles, and what is still open. It replaces the record the app keeps for this tab; it does NOT rename the tab.';

/** How a planning turn must not put the branch off until the plan lands. */
const PLAN_MODE_BRANCH_TIMING =
	'Do it now, in the same breath as the tab title, rather than once the plan is approved — and only once;';

/** The standing warning that the branch moves through the app or not at all. */
const BRANCH_TAIL =
	'never reach for `git branch -m` instead, which renames the branch behind the app.';

/** How to name a branch, shared by all four wordings. */
const BRANCH_CALL =
	'Call `ensemblr_set_branch_name` once with a kebab-case slug naming the work (2-5 words, e.g. `add-dark-mode`)';

/**
 * Describes what the naming call will actually move, which turns on whether the
 * workspace still answers to a name the app may replace.
 * @param namesWorkspace - Whether naming the branch also retitles the workspace.
 * @returns The clause completing the branch bullet.
 */
function branchCallEffect(namesWorkspace: boolean): string {
	return namesWorkspace
		? 'it renames the workspace and the git branch together and keeps any `prefix/` segment.'
		: 'it moves the branch, keeps any `prefix/` segment, and leaves the title the user chose alone.';
}

/**
 * Names the state the workspace is in, in the terms the agent has to act on. A
 * workspace the app has already named provisionally gets its own wording: the
 * call is the same, but asking for a first name would read as already done and
 * be skipped. Both wordings still turn on `namesWorkspace`, because a user who
 * has titled the workspace keeps that title through either call.
 * @param branch - The branch's current name, whether it is the app's own guess, and whether naming it also retitles the workspace.
 * @returns The opening sentence for this workspace's state.
 */
function branchSubject(branch: SessionBriefNaming['branch']): string {
	const where = branch.current ? ` \`${branch.current}\`` : '';
	if (branch.provisional) {
		return branch.namesWorkspace
			? `- Workspace & branch: the app named this workspace and its branch${where} from your first prompt so the board would not sit blank, but that was a guess made before anything had been read.`
			: `- Branch: the user has titled this workspace, but the app named its git branch${where} from your first prompt so the board would not sit blank, and that was a guess made before anything had been read.`;
	}
	return branch.namesWorkspace
		? `- Workspace & branch: this workspace still has its generated placeholder name and sits on the branch${where} it was cut with.`
		: `- Branch: the user has titled this workspace, but its git branch${where} still carries the name it was cut with.`;
}

/**
 * Builds the bullet asking the agent to name the branch, and the workspace with
 * it while the workspace has no chosen title.
 * @param branch - The branch's naming state.
 * @param planMode - Whether the calling session is planning, which changes only the timing.
 * @returns The branch upkeep bullet.
 */
function branchBullet(
	branch: SessionBriefNaming['branch'],
	planMode: boolean,
): string {
	const better = branch.provisional
		? ' that describes the work better —'
		: ' —';
	const timing = planMode
		? PLAN_MODE_BRANCH_TIMING
		: 'Do it now and only once;';
	return `${branchSubject(branch)} ${BRANCH_CALL}${better} ${branchCallEffect(branch.namesWorkspace)} ${timing} ${BRANCH_TAIL}`;
}

/**
 * Renders the upkeep block for a session's outstanding naming work.
 * @param naming - The upkeep the session still owes, from `getSessionBrief`.
 * @param planMode - Whether the calling session is planning, which changes both the framing and the timing of every bullet.
 * @returns The block to append to the system prompt, or null when nothing is outstanding.
 */
export function buildSessionBriefNudge(
	naming: SessionBriefNaming,
	planMode = false,
): string | null {
	const bullets = [
		naming.titleNeeded
			? planMode
				? PLAN_MODE_TITLE_BULLET
				: TITLE_BULLET
			: null,
		naming.branch.eligible ? branchBullet(naming.branch, planMode) : null,
		naming.summaryStale
			? planMode
				? PLAN_MODE_SUMMARY_BULLET
				: SUMMARY_BULLET
			: null,
	].filter((bullet) => bullet !== null);
	if (bullets.length === 0) {
		return null;
	}
	const preamble = planMode ? PLAN_MODE_NUDGE_PREAMBLE : NUDGE_PREAMBLE;
	return `${preamble}\n\n${bullets.join('\n')}`;
}

/**
 * Opening line of the refinement directive. Exported so a test can locate the
 * block inside a preamble it was joined into, which asserting on the whole
 * directive cannot do.
 */
export const PLAN_REFINEMENT_HEADER = 'PLAN AWAITING REVISION';

/**
 * Appended to every turn a session takes while a plan it submitted is still
 * awaiting a decision — the turn the Refine button produces.
 *
 * The playbooks already say a refinement ends in another submission, but they
 * say it in a list of three outcomes read once, several turns and one whole plan
 * ago. What actually arrives is a bare message, indistinguishable from an
 * ordinary follow-up, and the agent answers it in prose: the revision is real,
 * the plan file and the review bar are not, and the reader is left with a
 * refinement they cannot approve. This block is rebuilt from live state instead,
 * so the instruction is in front of the model on the turn it applies to.
 *
 * It says "whoever asked for the plan" rather than "the user" because a spawned
 * sub-agent reaches this too: `planModeFollowUpDenial` lets an orchestrator
 * follow up into a child that is itself planning, so the message answering a
 * child's plan comes from its parent.
 *
 * It names both plan-exit tools because both runtimes read it: Pi submits
 * through the control op, and Claude Code through its own native tool, and this
 * block rides the channel each of them already has.
 */
export const PLAN_REFINEMENT_DIRECTIVE = `${PLAN_REFINEMENT_HEADER} — you already submitted a plan and whoever asked for it is reading it. The message that follows is the answer to that plan, not a new request, and Plan Mode is still on: you are still planning, and you implement nothing.

End this turn the way you ended the last one. Fold what they asked for into the plan and submit the WHOLE revised plan through the same plan-exit tool you used before — \`ensemblr_exit_plan_mode\`, or your runtime's own \`ExitPlanMode\`. Pass the full plan rather than a note of what changed: the app posts what you pass and that is what they read and approve, so a submission naming only the edits replaces their plan with a fragment.

Stopping at prose is the one outcome this turn must not have — it leaves them a revision with nothing to approve it from. If the message is a question rather than a change, answer it and submit anyway: \`ensemblr_ask_user_question\` returns inside this turn, so a clarification you need costs you nothing, and a plan that needed no edit is resubmitted unchanged.`;
