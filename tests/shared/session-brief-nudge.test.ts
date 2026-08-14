import { describe, expect, test } from 'vitest';

import type { SessionBriefNaming } from '../../src/shared/agent-control/contracts';
import {
	buildSessionBriefNudge,
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

function naming(
	overrides: Partial<SessionBriefNaming> = {},
): SessionBriefNaming {
	return {
		branch: branch(),
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
		expect(nudge).not.toContain('renames the workspace and the git branch');
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
		expect(nudge).toContain('describes the work better');
		expect(nudge).not.toContain('still has its generated placeholder name');
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
		expect(nudge).not.toContain('renames the workspace and the git branch');
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
