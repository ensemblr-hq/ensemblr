import { describe, expect, it } from 'vitest';
import {
	AFK_WORKFLOW_HEADER,
	buildAfkWorkflowDirective,
} from '../../src/shared/agent-control.ts';

describe('afk delivery loop', () => {
	const directive = buildAfkWorkflowDirective(true) ?? '';

	it('renders nothing while the user is present', () => {
		expect(buildAfkWorkflowDirective(false)).toBeNull();
	});

	it('opens with the header a test can locate it by', () => {
		expect(directive).toContain(AFK_WORKFLOW_HEADER);
	});

	// The block is appended to every AFK turn, so an agent asked to explain a
	// function reads it too. Without the gate it would open a pull request for
	// work nobody asked to have shipped.
	it('gates itself on the turn being a change to the codebase', () => {
		expect(directive).toContain('change to this codebase');
		expect(directive).toContain('skip the rest of this block');
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

	// The whole point of the review step is that somebody other than the author
	// reads the change, and the two mechanics below are the ones an agent cannot
	// work out for itself.
	it('names the review tool and how to wait on what it opens', () => {
		expect(directive).toContain('ensemblr_start_review');
		expect(directive).toContain('targets');
		expect(directive).toContain('root orchestrator');
	});

	// Fixes belong in the conversation that found the problem, not back here.
	it('sends findings back to the review conversation rather than fixing them here', () => {
		expect(directive).toContain('ensemblr_send_follow_up');
		expect(directive).toContain('same');
	});

	// A loop with no exit is how an unattended run spends a night on the same
	// three findings.
	it('bounds the review rounds', () => {
		expect(directive).toContain('three');
	});

	it('opens a pull request and forbids merging it', () => {
		expect(directive).toContain('pull request');
		expect(directive).toContain('Never merge');
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
});
