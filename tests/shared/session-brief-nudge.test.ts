import { describe, expect, test } from 'vitest';

import type { SessionBriefNaming } from '../../src/shared/agent-control/contracts';
import {
	buildSessionBriefNudge,
	SESSION_BRIEF_NUDGE_HEADER,
} from '../../src/shared/agent-control/session-brief';

function naming(
	overrides: Partial<SessionBriefNaming> = {},
): SessionBriefNaming {
	return {
		branch: { current: null, eligible: false, namesWorkspace: true },
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
				branch: {
					current: 'psoldunov/bach',
					eligible: true,
					namesWorkspace: true,
				},
			}),
		);

		expect(nudge).toContain('ensemblr_set_branch_name');
		expect(nudge).toContain('psoldunov/bach');
		expect(nudge).not.toContain('ensemblr_set_name`');
	});

	test('never raises the branch tool when the user turned naming off', () => {
		const nudge = buildSessionBriefNudge(
			naming({
				branch: {
					current: 'psoldunov/bach',
					eligible: false,
					namesWorkspace: true,
				},
				summaryStale: true,
				titleNeeded: true,
			}),
		);

		expect(nudge).toContain('ensemblr_set_name');
		expect(nudge).toContain('ensemblr_set_summary');
		expect(nudge).not.toContain('ensemblr_set_branch_name');
		expect(nudge).not.toContain('psoldunov/bach');
	});

	test('omits the branch clause when the workspace has no branch', () => {
		const nudge = buildSessionBriefNudge(
			naming({
				branch: { current: null, eligible: true, namesWorkspace: true },
			}),
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
				branch: {
					current: 'psoldunov/bach',
					eligible: true,
					namesWorkspace: false,
				},
			}),
		);

		expect(nudge).toContain('ensemblr_set_branch_name');
		expect(nudge).toContain('leaves the title the user chose alone');
		expect(nudge).not.toContain('renames the workspace and the git branch');
	});

	test('warns the branch bullet off renaming the branch with git', () => {
		const nudge = buildSessionBriefNudge(
			naming({
				branch: {
					current: 'psoldunov/bach',
					eligible: true,
					namesWorkspace: true,
				},
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
					branch: {
						current: 'psoldunov/bach',
						eligible: true,
						namesWorkspace: true,
					},
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
					branch: {
						current: 'psoldunov/bach',
						eligible: true,
						namesWorkspace: true,
					},
					summaryStale: true,
					titleNeeded: true,
				}),
			) ?? '';

		expect(
			nudge.split('\n').filter((line) => line.startsWith('- ')),
		).toHaveLength(3);
	});
});
