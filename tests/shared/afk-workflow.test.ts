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
		for (const guidance of [directive, nativeDirective, subagentDirective]) {
			expect(guidance).toContain(AFK_WORKFLOW_HEADER);
		}
	});

	for (const delegation of ['ensemblr', 'native'] as const) {
		describe(delegation, () => {
			const guidance = render({ delegation });

			it('lets either mechanism self-review or delegate without the Review model pin', () => {
				expect(guidance).toContain(
					'Self-review is allowed, including on the full loop',
				);
				expect(guidance).toContain('normal delegation rules');
				expect(guidance).toContain(
					'manual Review button, not to AFK delegation',
				);
				expect(guidance).not.toContain('ensemblr_start_review');
				expect(guidance).not.toContain('Do not review your own work instead');
				expect(guidance).toContain('AFK does not require spawning');
				expect(guidance).toContain('do the work yourself by default');
			});

			it('keeps review, repairs, and checks mandatory without a delegate', () => {
				expect(guidance).toContain(
					'Read the whole branch diff against its base',
				);
				expect(guidance).toContain('make the repair here');
				expect(guidance).toContain(
					'Run the relevant checks and re-read the changed diff',
				);
				expect(guidance).toContain('Re-review does not require another agent');
				expect(guidance).toContain('Review the whole rebuilt change');
				expect(guidance).not.toContain(
					'by then the second reader is already reading',
				);
			});

			it('briefs optional reviewers as ordinary bounded read-only delegates', () => {
				expect(guidance).toContain('If you delegate review');
				expect(guidance).toContain('bounded, read-only review');
				expect(guidance).toContain('git diff');
				expect(guidance).toContain('full paths and line numbers');
				expect(guidance).toContain('A reviewer child has no delegation budget');
				expect(guidance).toContain('Leave the reviewed files alone');
			});

			it('falls back to self-review without bypassing a refused delegation', () => {
				expect(guidance).toContain('If delegation is unavailable or refused');
				expect(guidance).toContain(
					'do not retry in a loop or bypass the limit',
				);
				expect(guidance).toContain(
					'review the diff yourself and record the limitation',
				);
				expect(guidance).not.toContain('co-tenancy slot');
			});

			it('reports the review choice and its reason', () => {
				expect(guidance).toContain(
					'whether you self-reviewed or delegated review and why',
				);
				expect(guidance).toContain(
					'which path you sized the change onto and why',
				);
				expect(guidance).toContain(
					'every review finding you disagreed with and why',
				);
				expect(guidance).toContain('ensemblr_set_summary');
			});

			it('distinguishes PR merging from explicitly requested local integration', () => {
				expect(guidance).toContain('Never merge the pull request');
				expect(guidance).toContain('AFK delivery is not base-sync consent');
				expect(guidance).toContain(
					'explicit human request to integrate a named base or resolve merge conflicts',
				);
				expect(guidance).not.toContain('Never merge,');
			});
		});
	}

	it('gates itself on the turn being a change to the codebase', () => {
		expect(directive).toContain('change to this codebase');
		expect(directive).toContain('skip the rest of this block');
	});

	it('excludes an agent whose brief named somebody else as the committer', () => {
		expect(directive).toContain('as the committer');
		expect(directive).toContain('leave it in the working tree');
		expect(directive).toContain('follow-up asking you to fix what you found');
		expect(directive).toContain('as it does for a reviewer');
		expect(directive).toContain('a peer opened to take half the work');
		expect(directive).not.toContain('harness launched into this checkout');
	});

	it('sizes the loop before the steps, by evidence rather than diff size', () => {
		for (const guidance of [directive, nativeDirective]) {
			const sizing = guidance.indexOf('Size the loop to the change');
			expect(sizing).toBeGreaterThan(-1);
			expect(sizing).toBeLessThan(guidance.indexOf('**1.'));
			expect(guidance).toContain('steps 1, 3, and 4 do not run');
			expect(guidance).toContain(
				'the whole diff fits in one reading of your own',
			);
			expect(guidance).toContain('the shape was decided before you started');
			expect(guidance).toContain('however few lines they end up being');
		}
	});

	it('requires an adversarial reading and delivery on the short path', () => {
		expect(directive).toContain('read the diff you produced from the top');
		expect(directive).toContain('That reading is not a formality');
		expect(directive).toContain(
			'still committed, pushed, and opened as a pull request',
		);
	});

	it('breaks the tie towards the full loop without forcing another agent', () => {
		expect(directive).toContain('it is on the full loop');
		expect(directive).toContain('pick the loop up at step 1');
		expect(directive).toContain('does not drop out of it to save time');
		expect(directive).toContain('it does not require another agent');
	});

	it('leaves the user-named correction to the scope gate alone', () => {
		expect(
			directive.split('correction the user asked for by name'),
		).toHaveLength(2);
		expect(directive).toContain(
			'a one-line correction the user asked for by name',
		);
		expect(directive).toContain(
			'a rename the compiler follows end to end — those are the short path',
		);
	});

	it('runs plan, build, review, fix, and ship in that order', () => {
		const positions = ['**1.', '**2.', '**3.', '**4.', '**5.'].map((step) =>
			directive.indexOf(step),
		);
		expect(positions.every((position) => position > -1)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});

	it('keeps model-role selection live for unattended Ensemblr hand-offs', () => {
		for (const clause of [
			'ensemblr_list_models',
			"user's role preferences",
			'prefer a model tagged for it',
			'name the role in the brief',
			'allowedRuntimes',
			'meaningful departure',
			'once before each fan-out batch',
			'Reuse that result for every child in the batch',
			'refresh it before a later batch',
			'thinking level deliberately',
			'normal cost-approval rules',
		])
			expect(directive).toContain(clause);
	});

	it('preserves role boundaries and keeps the decisions with the orchestrator', () => {
		for (const guidance of [directive, nativeDirective]) {
			for (const role of ['Sage', 'Coder', 'Builder', 'Grunt', 'Explorer']) {
				expect(guidance).toContain(role);
			}
			expect(guidance).toContain('zero-judgment');
			expect(guidance).toContain('Explorer stays read-only');
			expect(guidance).toContain('A role never grants tools');
			expect(guidance).toContain('If that survey earns delegation');
			expect(guidance).toContain(
				'Keep the plan, the design calls, and reconciliation here',
			);
		}
	});

	it('follows up only when a review was delegated and cleans up its child tabs', () => {
		expect(directive).toContain("If a delegated reader's report needs");
		expect(directive).toContain('ensemblr_send_follow_up');
		expect(directive).toContain('while its context remains suitable');
		expect(directive).toContain('Close each delegate tab');
		expect(directive).not.toContain(
			'hands you back the reviewer you already have',
		);
	});

	it('bounds review rounds by progress and stops when replanning cannot fix the approach', () => {
		expect(directive).toContain('Steps 1 to 4 are a loop');
		expect(directive).toContain('Nothing caps the rounds');
		expect(directive).toContain('paid for by something actually changing');
		expect(directive).toContain('nothing you agree needs fixing');
		expect(directive).toContain('circling the same class of problem');
		expect(directive).toContain('go back to step 1');
		expect(directive).toContain('re-planning does not break the circle');
	});

	it('permits delivery from either path but withholds the PR while real problems stand', () => {
		expect(directive).toContain(
			"the loop ended clean, or the short path's own reading came back clean",
		);
		expect(directive).toContain(
			'If real problems are still standing — the loop ended with them, or your own reading found one you could not settle — do not open the pull request',
		);
	});

	it('separates a hard block from an ordinary uncertainty', () => {
		expect(directive).toContain('hard block');
		expect(directive).toContain('Being unsure is not a hard block');
	});

	it('gives native delegation only the mechanism and model information it can use', () => {
		expect(nativeDirective).toContain("your own runtime's sub-agent tool");
		expect(nativeDirective).toContain(
			"cannot read the user's configured model-role tags or cross runtimes",
		);
		expect(nativeDirective).toContain('name it in every brief');
		expect(nativeDirective).toContain(
			'If another delegated reading is warranted',
		);
		expect(nativeDirective).not.toContain('ensemblr_send_follow_up');
		expect(nativeDirective).not.toContain('ensemblr_start_conversation');
	});

	describe('a spawned sub-agent', () => {
		it('reads neither the steps, the sizing gate, nor the fan-out', () => {
			expect(subagentDirective).not.toContain('**1.');
			expect(subagentDirective).not.toContain('**5.');
			expect(subagentDirective).not.toContain('short path');
			expect(subagentDirective).not.toContain('Size the loop');
			expect(subagentDirective).not.toContain('ensemblr_start_conversation');
			expect(subagentDirective).toContain('Nested delegation is blocked');
		});

		it('is told the change is not its to commit, at any depth', () => {
			expect(subagentDirective).toContain('is not yours');
			expect(subagentDirective).toContain(
				'the commit, the review, and the pull request all sit above you',
			);
			expect(subagentDirective).toContain('however many levels up that is');
			expect(subagentDirective).toContain('leave it in the working tree');
		});

		it('keeps verification discipline and obeys the named role before AFK ambiguity defaults', () => {
			expect(subagentDirective).toContain(
				'Decide the approach before the first edit',
			);
			expect(subagentDirective).toContain('name the assumption');
			expect(subagentDirective).toContain(
				'Follow the advisory task role named in the brief',
			);
			expect(subagentDirective).toContain(
				'Grunt encounters ambiguity or a failed precondition',
			);
			expect(subagentDirective).toContain('Explorer makes no edits');
			expect(subagentDirective).toContain(
				'Where your unit of work changed files',
			);
			expect(subagentDirective).toContain('has nothing to check');
		});
	});
});
