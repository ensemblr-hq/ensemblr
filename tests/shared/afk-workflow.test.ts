import { describe, expect, it } from 'vitest';
import {
	AFK_WORKFLOW_HEADER,
	buildAfkWorkflowDirective,
} from '../../src/shared/agent-control.ts';

describe('afk delivery loop', () => {
	const render = (
		overrides: Partial<Parameters<typeof buildAfkWorkflowDirective>[0]> = {},
	): string =>
		buildAfkWorkflowDirective({
			delegation: 'ensemblr',
			role: 'orchestrator',
			unattended: true,
			...overrides,
		}) ?? '';

	const directive = render();
	const nativeDirective = render({ delegation: 'native' });
	const subagentDirective = render({ role: 'subagent' });

	it('renders nothing while the user is present', () => {
		expect(
			buildAfkWorkflowDirective({
				delegation: 'ensemblr',
				role: 'orchestrator',
				unattended: false,
			}),
		).toBeNull();
	});

	it('opens with the header a test can locate it by', () => {
		expect(directive).toContain(AFK_WORKFLOW_HEADER);
		expect(nativeDirective).toContain(AFK_WORKFLOW_HEADER);
		expect(subagentDirective).toContain(AFK_WORKFLOW_HEADER);
	});

	// The block is appended to every AFK turn, so an agent asked to explain a
	// function reads it too. Without the gate it would open a pull request for
	// work nobody asked to have shipped.
	it('gates itself on the turn being a change to the codebase', () => {
		expect(directive).toContain('change to this codebase');
		expect(directive).toContain('skip the rest of this block');
	});

	// A review and a peer both inherit the opener's AFK mode, so both read this
	// block — and the turn where one is asked to fix what it found is a change to
	// the codebase by the first gate's own definition. Without this second gate
	// that turn ends in a commit and a pull request the agent's opening brief
	// forbids, racing the orchestrator that owns them.
	it('excludes an agent whose brief named somebody else as the committer', () => {
		expect(directive).toContain('as the committer');
		expect(directive).toContain('leave it in the working tree');
		expect(directive).toContain('follow-up asking you to fix what you found');
	});

	// The gate is self-checking — it asks what this conversation's own brief said —
	// so an example only works if the reader can match it. A harness brief names no
	// committer above the harness, so naming one here offers a test it cannot run.
	it('offers the reviewer and the peer as examples a reader can check', () => {
		expect(directive).toContain('as it does for a reviewer');
		expect(directive).toContain('a peer opened to take half the work');
		expect(directive).not.toContain('harness launched into this checkout');
	});

	// The five steps in order. Asserted by their leading numbers rather than by
	// prose so a rewording does not silently drop one.
	it('runs plan, build, review, fix, and ship in that order', () => {
		const positions = ['**1.', '**2.', '**3.', '**4.', '**5.'].map((step) =>
			directive.indexOf(step),
		);

		expect(positions.every((position) => position > -1)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});

	// The run ends when the orchestrator's context does, so the block has to say
	// that reading belongs in a child's window — and has to say it before step 1,
	// which is where the widest read of the run happens.
	it('asks for the reading to be spent out of a sub-agent context', () => {
		const delegation = directive.indexOf("Spend a sub-agent's context");
		expect(delegation).toBeGreaterThan(-1);
		expect(delegation).toBeLessThan(directive.indexOf('**1.'));
		expect(directive).toContain('context window runs out');
		expect(directive).toContain('Hand over the reading, keep the deciding');
	});

	// The role playbook says to delegate only for two or more parallel
	// workstreams. An agent holding that and "delegate more" with nothing saying
	// which governs picks one by guess, so the override has to be explicit.
	it('overrides the playbook default rather than contradicting it silently', () => {
		expect(directive).toContain('role playbook');
		expect(directive).toContain(
			'material you will not need again, whether or not anything else runs beside it',
		);
	});

	// Delegating the change itself is the failure mode the encouragement invites,
	// so the block names the half that stays.
	it('keeps the plan and the load-bearing edits out of the fan-out', () => {
		expect(directive).toContain('Not worth handing over: the plan');
		expect(directive).toContain('cannot delegate');
	});

	// The whole point of the review step is that somebody other than the author
	// reads the change, and the two mechanics below are the ones an agent cannot
	// work out for itself.
	it('names the review tool and how to wait on what it opens', () => {
		expect(directive).toContain('ensemblr_start_review');
		expect(directive).toContain('root orchestrator rather than your child');
		expect(directive).toContain('targets');
		expect(directive).not.toContain('one of your own sub-agents');
	});

	// The review takes a co-tenancy slot again, so a full workspace refuses a step
	// the loop treats as mandatory — and nothing the agent can do frees one, since
	// a running harness is the user's to close.
	it('says what to do when the review is refused for quota', () => {
		expect(directive).toContain('denied-quota');
		expect(directive).toContain('Do not retry it in a loop');
		expect(directive).toContain('the second reading was refused');
	});

	// Fixes belong in the conversation that found the problem, not back here.
	it('sends findings back to the review conversation rather than fixing them here', () => {
		expect(directive).toContain('ensemblr_send_follow_up');
		expect(directive).toContain('same');
	});

	// The op hands the open reviewer back rather than seating a second one, so the
	// block states that outcome instead of arguing against a call the app allows.
	// The reason is still carried, because it is what makes the outcome the right
	// one rather than a limitation to work around.
	it('re-reviews in the same conversation rather than opening a second', () => {
		expect(directive).toContain('ask that same conversation to re-review');
		expect(directive).toContain('hands you back the reviewer you already have');
		expect(directive).toContain('re-read the whole diff from cold');
		expect(directive).not.toContain('repeat step 3');
	});

	// A count either cuts off a run that was still converging or licenses rounds
	// that stopped paying for themselves. The agent inside the loop is the only
	// party that can tell those apart, so the bound is progress rather than a
	// number.
	it('lets the pre-pull-request core run as many rounds as it earns', () => {
		expect(directive).toContain('Steps 1 to 4 are a loop');
		expect(directive).toContain('Nothing caps the rounds');
		expect(directive).toContain('paid for by something actually changing');
		expect(directive).not.toContain('three** rounds');
	});

	// Without a stop condition the loop is how an unattended run spends a night
	// on the same three findings, and re-planning is the answer to a circle that
	// grinding step 4 cannot break.
	it('names what ends the loop, including a wrong approach', () => {
		expect(directive).toContain('nothing you agree needs fixing');
		expect(directive).toContain('circling the same class of problem');
		expect(directive).toContain('go back to step 1');
		expect(directive).toContain('re-planning does not break the circle');
	});

	// Re-entering at step 1 walks back through step 3, and step 3 says to call
	// `ensemblr_start_review` — which answers with the reviewer already open. Step
	// 4 says the same for an ordinary round, but the re-entry bypasses step 4, so
	// the fact has to be here too.
	it('re-reads a rebuilt change without opening a second review', () => {
		const reEntry = directive.indexOf('rebuild from there');
		expect(reEntry).toBeGreaterThan(-1);
		expect(directive).toContain(
			'Send the rebuilt change back to the reviewer you already have',
		);
		expect(directive.indexOf('hands that same reviewer back')).toBeGreaterThan(
			reEntry,
		);
	});

	it('opens a pull request and forbids merging it', () => {
		expect(directive).toContain('pull request');
		expect(directive).toContain('Never merge');
	});

	it('withholds the pull request while real problems stand', () => {
		expect(directive).toContain(
			'If the loop ended with real problems still standing, do not open the pull request',
		);
	});

	// "Blocked" is the word a model reaches for when a task is merely hard, so
	// the block has to separate the two or the run stops at the first difficulty.
	it('separates a hard block from an ordinary uncertainty', () => {
		expect(directive).toContain('hard block');
		expect(directive).toContain('Being unsure is not a hard block');
	});

	it('asks for the honest report the user comes back to', () => {
		expect(directive).toContain('final message');
		expect(directive).toContain('ensemblr_set_summary');
	});

	describe('a root delegating through its own runtime', () => {
		// `startReview` and `sendFollowUp` are both in
		// `NATIVE_DELEGATION_WITHHELD_OPS`, so the default wording orders two tools
		// this caller does not hold — and it reads the block on every turn while
		// the playbook that says so was read once at session open.
		it('is told the review op is absent and to spawn its own reader', () => {
			expect(nativeDirective).toContain(
				'`ensemblr_start_review` is absent from your tool list',
			);
			expect(nativeDirective).not.toContain('ensemblr_send_follow_up');
			expect(nativeDirective).not.toContain('ensemblr_start_conversation');
		});

		it('briefs that reader with what a review needs to be actionable', () => {
			expect(nativeDirective).toContain('git diff');
			expect(nativeDirective).toContain('full paths and line numbers');
		});

		// A sub-agent ends with its report, so the re-read of a fix round is a
		// second child rather than a follow-up into the first.
		it('re-reviews with a fresh child rather than a follow-up', () => {
			expect(nativeDirective).toContain('a second reading is a second child');
		});

		it('carries the same delegation posture and the same loop', () => {
			expect(nativeDirective).toContain("Spend a sub-agent's context");
			expect(nativeDirective).toContain('Steps 1 to 4 are a loop');
		});

		// Nothing is still open here to follow up, so the co-tenancy sentence the
		// other mechanism needs would be an instruction against a conversation this
		// caller never opened.
		it('re-reads a rebuilt change with a fresh child rather than a follow-up', () => {
			expect(nativeDirective).toContain(
				'Brief a fresh reviewer child over the rebuilt change',
			);
			expect(nativeDirective).toContain('give it the whole of that change');
			expect(nativeDirective).not.toContain('co-tenancy slot');
		});
	});

	describe('a spawned sub-agent', () => {
		// Nested delegation is blocked on every axis, so the delegation block would
		// be an instruction it cannot follow, and the numbered steps name ops it
		// does not hold.
		it('reads neither the steps nor the fan-out', () => {
			expect(subagentDirective).not.toContain('**1.');
			expect(subagentDirective).not.toContain('**5.');
			expect(subagentDirective).not.toContain('ensemblr_start_conversation');
			expect(subagentDirective).toContain('Nested delegation is blocked');
		});

		// Named as what the child does not do rather than as what its parent does:
		// a reviewer and a peer are roots that read this file too, so a child of one
		// has its commit two levels up and "your orchestrator commits" would be
		// false for it.
		it('is told the change is not its to commit, at any depth', () => {
			expect(subagentDirective).toContain('is not yours');
			expect(subagentDirective).toContain(
				'the commit, the review, and the pull request all sit above you',
			);
			expect(subagentDirective).toContain('however many levels up that is');
			expect(subagentDirective).toContain('leave it in the working tree');
		});

		// The discipline the loop exists for applies to a child's unwatched turn
		// exactly as it does to its orchestrator's.
		it('keeps the discipline the loop exists for', () => {
			expect(subagentDirective).toContain(
				'Decide the approach before the first edit',
			);
			expect(subagentDirective).toContain('name the assumption');
		});

		// The block above it recruits read-only children by name — the survey
		// before a plan, the triage of a failing suite — so an ungated "run the
		// checks" spends a minute of an unattended run per scout on a tree the
		// child never wrote to.
		it('asks for the repository checks only where the work changed files', () => {
			expect(subagentDirective).toContain(
				'Where your unit of work changed files',
			);
			expect(subagentDirective).toContain('has nothing to check');
		});
	});
});
