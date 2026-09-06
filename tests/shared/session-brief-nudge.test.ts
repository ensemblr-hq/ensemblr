import { describe, expect, test } from 'vitest';

import type { SessionBriefNaming } from '../../src/shared/agent-control/contracts';
import {
	buildPlanModeDelegationDirective,
	buildSessionBriefNudge,
	PLAN_MODE_DELEGATION_HEADER,
	SESSION_BRIEF_NUDGE_HEADER,
} from '../../src/shared/agent-control/session-brief';

function branch(
	overrides: Partial<SessionBriefNaming['branch']> = {},
): SessionBriefNaming['branch'] {
	return {
		current: null,
		eligible: false,
		namesWorkspace: true,
		provisional: false,
		...overrides,
	};
}

function diagram(
	overrides: Partial<SessionBriefNaming['diagram']> = {},
): SessionBriefNaming['diagram'] {
	return { components: [], stale: false, ...overrides };
}

function naming(
	overrides: Partial<SessionBriefNaming> = {},
): SessionBriefNaming {
	return {
		branch: branch(),
		diagram: diagram(),
		summaryStale: false,
		titleNeeded: false,
		...overrides,
	};
}

describe('buildSessionBriefNudge', () => {
	test('renders nothing when no upkeep is outstanding', () => {
		expect(buildSessionBriefNudge(naming())).toBeNull();
	});

	test('names the title tool when the tab is still auto-titled', () => {
		const nudge = buildSessionBriefNudge(naming({ titleNeeded: true }));

		expect(nudge).toContain(SESSION_BRIEF_NUDGE_HEADER);
		expect(nudge).toContain('ensemblr_set_name');
		expect(nudge).not.toContain('ensemblr_set_branch_name');
		expect(nudge).not.toContain('ensemblr_set_summary');
	});

	test('names the branch tool and the current branch when still a placeholder', () => {
		const nudge = buildSessionBriefNudge(
			naming({
				branch: branch({ current: 'octocat/bach', eligible: true }),
			}),
		);

		expect(nudge).toContain('ensemblr_set_branch_name');
		expect(nudge).toContain('octocat/bach');
		expect(nudge).not.toContain('ensemblr_set_name`');
		expect(nudge).toMatch(
			/name for the work \(2-5 words, e\.g\. `Add dark mode`\) — it titles the workspace/,
		);
	});

	test('never raises the branch tool when the user turned naming off', () => {
		const nudge = buildSessionBriefNudge(
			naming({
				branch: branch({ current: 'octocat/bach' }),
				summaryStale: true,
				titleNeeded: true,
			}),
		);

		expect(nudge).toContain('ensemblr_set_name');
		expect(nudge).toContain('ensemblr_set_summary');
		expect(nudge).not.toContain('ensemblr_set_branch_name');
		expect(nudge).not.toContain('octocat/bach');
	});

	test('omits the branch clause when the workspace has no branch', () => {
		const nudge = buildSessionBriefNudge(
			naming({ branch: branch({ eligible: true }) }),
		);

		expect(nudge).toContain('ensemblr_set_branch_name');
		expect(nudge).not.toContain('sits on branch');
	});

	// A workspace the user has titled keeps that title; only its branch moves. A
	// bullet still promising to rename the workspace would read as a clobber the
	// agent has to decline.
	test('asks for the branch alone once the user has titled the workspace', () => {
		const nudge = buildSessionBriefNudge(
			naming({
				branch: branch({
					current: 'octocat/bach',
					eligible: true,
					namesWorkspace: false,
				}),
			}),
		);

		expect(nudge).toContain('ensemblr_set_branch_name');
		expect(nudge).toContain('leaves the title the user chose alone');
		expect(nudge).not.toContain(
			'titles the workspace with the name as you wrote it',
		);
	});

	test('warns the branch bullet off renaming the branch with git', () => {
		const nudge = buildSessionBriefNudge(
			naming({
				branch: branch({ current: 'octocat/bach', eligible: true }),
			}),
		);

		expect(nudge).toContain('git branch -m');
	});

	test('names the summary tool when the record has fallen behind', () => {
		const nudge = buildSessionBriefNudge(naming({ summaryStale: true }));

		expect(nudge).toContain('ensemblr_set_summary');
		expect(nudge).not.toContain('ensemblr_set_branch_name');
	});

	test('warns the summary tool does not rename the tab', () => {
		const nudge = buildSessionBriefNudge(naming({ summaryStale: true }));

		expect(nudge).toContain('does NOT rename the tab');
	});

	// "Once this turn's work is done" reads as "after you have answered", and a
	// summary call landing after the answer folds that answer into the turn's
	// collapsed activity row. The bullet has to place the call before the answer.
	test('places the summary call before the closing answer to the user', () => {
		const nudge = buildSessionBriefNudge(naming({ summaryStale: true }));

		expect(nudge).toContain('BEFORE you write your closing answer');
		expect(nudge).not.toContain("Once this turn's work is done");
	});

	test('says nothing about the diagram when it is not stale', () => {
		const nudge = buildSessionBriefNudge(naming({ summaryStale: true })) ?? '';

		expect(nudge).not.toContain('ensemblr_update_architecture_diagram');
	});

	test('asks for a redraw when the diagram has fallen behind the code', () => {
		const nudge = buildSessionBriefNudge(
			naming({ diagram: diagram({ stale: true }) }),
		);

		expect(nudge).toContain('ensemblr_get_architecture_diagram');
		expect(nudge).toContain('ensemblr_update_architecture_diagram');
	});

	test('names the components the change set landed in', () => {
		const nudge =
			buildSessionBriefNudge(
				naming({
					diagram: diagram({
						components: ['storage', 'IPC'],
						stale: true,
					}),
				}),
			) ?? '';

		expect(nudge).toContain('`storage` and `IPC`');
	});

	// The read is what stops an update replacing a document another pass refined:
	// there is no patch op, so a write without a read discards the whole drawing.
	test('orders the diagram read before the diagram write', () => {
		const nudge =
			buildSessionBriefNudge(naming({ diagram: diagram({ stale: true }) })) ??
			'';

		expect(nudge.indexOf('ensemblr_get_architecture_diagram')).toBeLessThan(
			nudge.indexOf('ensemblr_update_architecture_diagram'),
		);
	});

	// A shape that did not move is the common case for a diagram-adjacent edit,
	// and storing an identical document is a diff the user has to read for
	// nothing.
	test('lets the agent store nothing when the shape did not move', () => {
		const nudge =
			buildSessionBriefNudge(naming({ diagram: diagram({ stale: true }) })) ??
			'';

		expect(nudge).toContain('store nothing');
	});

	test('orders the outstanding items title, branch, then summary', () => {
		const nudge =
			buildSessionBriefNudge(
				naming({
					branch: branch({ current: 'octocat/bach', eligible: true }),
					summaryStale: true,
					titleNeeded: true,
				}),
			) ?? '';

		expect(nudge.indexOf('ensemblr_set_name')).toBeLessThan(
			nudge.indexOf('ensemblr_set_branch_name'),
		);
		expect(nudge.indexOf('ensemblr_set_branch_name')).toBeLessThan(
			nudge.indexOf('ensemblr_set_summary'),
		);
	});

	test('renders each outstanding item as one bullet', () => {
		const nudge =
			buildSessionBriefNudge(
				naming({
					branch: branch({ current: 'octocat/bach', eligible: true }),
					summaryStale: true,
					titleNeeded: true,
				}),
			) ?? '';

		expect(
			nudge.split('\n').filter((line) => line.startsWith('- ')),
		).toHaveLength(3);
	});
});

// Claude Code learns of Plan Mode only as the SDK's `permissionMode: 'plan'`,
// which brings its own "MUST NOT run any non-readonly tools" instruction. The
// Pi-only `PLAN_MODE_UPKEEP_CLAUSE` never reaches it, so the carve-out has to
// ride in this block or every name is deferred until after the plan lands.
describe('buildSessionBriefNudge in Plan Mode', () => {
	const planning = naming({
		branch: branch({ current: 'octocat/bach', eligible: true }),
		summaryStale: true,
		titleNeeded: true,
	});

	test('still renders nothing when no upkeep is outstanding', () => {
		expect(buildSessionBriefNudge(naming(), true)).toBeNull();
	});

	// `updateArchitectureDiagram` is refused while planning, so asking for a
	// redraw would only send the agent after a denial.
	test('drops the diagram bullet rather than retiming it', () => {
		const stale = naming({ diagram: diagram({ stale: true }) });

		expect(buildSessionBriefNudge(stale, true)).toBeNull();
		expect(buildSessionBriefNudge(stale, false)).toContain(
			'ensemblr_update_architecture_diagram',
		);
	});

	test('states that every item stays allowed while planning', () => {
		const nudge = buildSessionBriefNudge(planning, true) ?? '';

		expect(nudge).toContain('You are planning, and every item below is still');
		expect(nudge).toContain('A restriction on non-read-only tools does not');
	});

	test('tells the agent to name now rather than after the plan', () => {
		const nudge = buildSessionBriefNudge(planning, true) ?? '';

		expect(nudge).toContain('before you read the repository');
		expect(nudge).toContain('rather than once the plan is approved');
	});

	// A planning agent produces nothing after `ensemblr_exit_plan_mode`, so the
	// standard "before your closing answer" wording names a slot it never reaches.
	test('retimes the summary call to before the plan is submitted', () => {
		const nudge = buildSessionBriefNudge(planning, true) ?? '';

		expect(nudge).toContain('before `ensemblr_exit_plan_mode`');
		expect(nudge).not.toContain('BEFORE you write your closing answer');
	});

	test('asks for a better name once the app has named the workspace itself', () => {
		const nudge =
			buildSessionBriefNudge(
				naming({
					branch: branch({
						current: 'octocat/add-dark-mode',
						eligible: true,
						provisional: true,
					}),
				}),
				true,
			) ?? '';

		expect(nudge).toContain('ensemblr_set_branch_name');
		expect(nudge).toContain('that was a guess');
		expect(nudge).not.toContain('still has its generated placeholder name');
		// `branchBullet` grafts this clause straight onto the end of the shared
		// call sentence, so that sentence has to end on the noun naming the
		// argument. Asserting the junction rather than the clause alone is what
		// catches a reworded `BRANCH_CALL` ending on a subordinate clause.
		expect(nudge).toMatch(
			/name for the work \(2-5 words, e\.g\. `Add dark mode`\) that describes the work better — it titles the workspace/,
		);
	});

	// `provisional` and `namesWorkspace` move independently: a workspace the user
	// retitled before planning keeps that title through the agent's call too, so
	// promising to rename it would describe a rename that will not happen.
	test('still says the branch alone moves when the user has titled the workspace', () => {
		const nudge =
			buildSessionBriefNudge(
				naming({
					branch: branch({
						current: 'octocat/add-dark-mode',
						eligible: true,
						namesWorkspace: false,
						provisional: true,
					}),
				}),
				true,
			) ?? '';

		expect(nudge).toContain('that was a guess');
		expect(nudge).toContain('leaves the title the user chose alone');
		expect(nudge).not.toContain(
			'titles the workspace with the name as you wrote it',
		);
	});

	test('keeps the git warning on the provisional branch bullet', () => {
		const nudge =
			buildSessionBriefNudge(
				naming({
					branch: branch({
						current: 'octocat/add-dark-mode',
						eligible: true,
						provisional: true,
					}),
				}),
				true,
			) ?? '';

		expect(nudge).toContain('git branch -m');
	});

	test('leaves the non-planning wording untouched', () => {
		const nudge = buildSessionBriefNudge(planning) ?? '';

		expect(nudge).not.toContain('You are planning');
		expect(nudge).toContain('BEFORE you write your closing answer');
		expect(nudge).toContain('Do it now and only once;');
	});
});

describe('buildPlanModeDelegationDirective', () => {
	const root =
		buildPlanModeDelegationDirective({
			delegation: 'ensemblr',
			role: 'orchestrator',
		}) ?? '';
	const native =
		buildPlanModeDelegationDirective({
			delegation: 'native',
			role: 'orchestrator',
		}) ?? '';
	const child =
		buildPlanModeDelegationDirective({
			delegation: 'ensemblr',
			role: 'subagent',
		}) ?? '';

	test('opens every variant with the header a preamble can be searched for', () => {
		for (const directive of [root, native, child]) {
			expect(directive.startsWith(PLAN_MODE_DELEGATION_HEADER)).toBe(true);
		}
	});

	// The Concierge holds no `ensemblr_exit_plan_mode` and fans out from a panel
	// rather than a plan, so the root block would point it at an op it is denied.
	// Refused on the role, not left to the caller's plan-mode gate.
	test('gives a Concierge nothing, whatever mechanism it opened under', () => {
		for (const delegation of ['ensemblr', 'native'] as const) {
			expect(
				buildPlanModeDelegationDirective({ delegation, role: 'concierge' }),
			).toBeNull();
		}
	});

	test('names both pieces of harness text it is answering', () => {
		for (const directive of [root, native, child]) {
			expect(directive).toContain('Explore');
			expect(directive).toContain('AgentTool');
		}
	});

	test('tells the agent not to narrate the conflict', () => {
		expect(root).toContain('do not spend the turn narrating the conflict');
	});

	test('points a default root at the mechanism that replaced its own tool', () => {
		expect(root).toContain('ensemblr_start_conversation');
		expect(root).toContain('ensemblr_wait_for_agents');
		expect(root).toContain('is denied in this session');
	});

	test('says the standing line is not a ban on delegating', () => {
		expect(root).toContain('It is not a ban on delegating');
	});

	test('holds a default root to a fan-out it actually needs', () => {
		expect(root).toContain('two or more genuinely independent areas');
	});

	test('tells a native root its own workflow fan-out is the right one', () => {
		expect(native).toContain('does not govern it');
		expect(native).toContain('absent rather than discouraged');
	});

	test('withholds the chat-tab mechanism from a native root', () => {
		expect(native).not.toContain('is denied in this session');
	});

	test('blocks an investigator from fanning out at all', () => {
		expect(child).toContain('nested delegation is blocked on every axis');
		expect(child).not.toContain('ensemblr_start_conversation');
	});

	test('blocks an investigator from submitting a plan', () => {
		expect(child).toContain('ExitPlanMode');
		expect(child).toContain('ensemblr_exit_plan_mode');
		expect(child).toContain('belong to the orchestrator that spawned you');
	});

	test('closes every variant on the plan file the harness names', () => {
		for (const directive of [root, native, child]) {
			expect(directive).toContain('~/.claude/plans/');
			expect(directive).toContain(
				'Do not write the plan file your workflow names',
			);
		}
	});

	test('names where a root plan actually lands', () => {
		for (const directive of [root, native]) {
			expect(directive).toContain('.context/plans/');
		}
	});

	test('tells an investigator its report is the whole output', () => {
		expect(child).toContain('Your report is your whole output');
		expect(child).not.toContain('.context/plans/');
	});
});
