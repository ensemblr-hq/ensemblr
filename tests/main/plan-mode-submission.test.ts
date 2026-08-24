import { describe, expect, it, vi } from 'vitest';
import type { AgentControlOrigin } from '../../src/main/agent-control/ports.ts';
import { createPlanSubmission } from '../../src/main/plan-mode/exit-plan-mode.ts';
import type { ExitPlanModeBroadcast } from '../../src/shared/agent-control.ts';

const ORIGIN: AgentControlOrigin = {
	delegation: 'ensemblr',
	concierge: false,
	depth: 0,
	parentSessionId: null,
	sessionId: 'sess-1',
	species: 'pi',
	token: 'tok',
	workspaceCwd: '/tmp/workspace',
	workspaceId: 'ws-1',
};

const ARGS = { plan: '# Steps\n\n1. Do it', title: 'Add Plan Mode' };

const PLAN_PATH = '.context/plans/20260728-1432-add-plan-mode.md';

const setup = (
	options: { hasRenderer?: boolean; writeFails?: boolean } = {},
) => {
	const reviews: ExitPlanModeBroadcast[] = [];
	const markSubmitted = vi.fn();
	const postPlanMessage = vi.fn();
	const writePlanFile = options.writeFails
		? vi.fn().mockRejectedValue(new Error('disk full'))
		: vi.fn().mockResolvedValue(PLAN_PATH);
	let nextId = 0;
	const submission = createPlanSubmission({
		broadcastReview: (payload) => reviews.push(payload),
		createRequestId: () => `req-${++nextId}`,
		hasRenderer: () => options.hasRenderer ?? true,
		markSubmitted,
		planFileWriter: { writePlanFile },
		postPlanMessage,
	});
	return { markSubmitted, postPlanMessage, reviews, submission, writePlanFile };
};

describe('plan submission', () => {
	it('saves the plan and broadcasts the review to the owning chat', async () => {
		const { postPlanMessage, reviews, submission, writePlanFile } = setup();

		await submission.submit({ args: ARGS, origin: ORIGIN });

		expect(writePlanFile).toHaveBeenCalledWith({
			agentSessionId: 'sess-1',
			plan: ARGS.plan,
			title: ARGS.title,
			workspaceCwd: '/tmp/workspace',
			workspaceId: 'ws-1',
		});
		expect(postPlanMessage).toHaveBeenCalledWith({
			plan: ARGS.plan,
			sessionId: 'sess-1',
		});
		expect(reviews).toEqual([
			{
				agentSessionId: 'sess-1',
				planPath: PLAN_PATH,
				requestId: 'req-1',
				title: ARGS.title,
				workspaceId: 'ws-1',
			},
		]);
	});

	it('returns without waiting on the user', async () => {
		const { submission } = setup();

		const result = await submission.submit({ args: ARGS, origin: ORIGIN });

		expect(result.planPath).toBe(PLAN_PATH);
		expect(result.summary).toContain(PLAN_PATH);
	});

	it('tells the agent its turn ends here', async () => {
		const { submission } = setup();

		const { summary } = await submission.submit({ args: ARGS, origin: ORIGIN });

		expect(summary).toContain('Your turn ends here');
		expect(summary).toContain('do not start implementing');
		expect(summary).toContain('arrives as your next prompt');
	});

	it('accepts a second plan — nothing is pending to collide with', async () => {
		const { reviews, submission } = setup();

		await submission.submit({ args: ARGS, origin: ORIGIN });
		await submission.submit({ args: ARGS, origin: ORIGIN });

		expect(reviews.map((review) => review.requestId)).toEqual([
			'req-1',
			'req-2',
		]);
	});

	it('posts the plan into the conversation, so the user sees it even if the agent never wrote it out', async () => {
		const { postPlanMessage, submission } = setup();

		await submission.submit({ args: ARGS, origin: ORIGIN });

		expect(postPlanMessage).toHaveBeenCalledWith({
			plan: ARGS.plan,
			sessionId: 'sess-1',
		});
	});

	it('still saves the plan when no window can show the review', async () => {
		const { postPlanMessage, reviews, submission, writePlanFile } = setup({
			hasRenderer: false,
		});

		const result = await submission.submit({ args: ARGS, origin: ORIGIN });

		expect(writePlanFile).toHaveBeenCalledTimes(1);
		expect(reviews).toHaveLength(0);
		expect(postPlanMessage).toHaveBeenCalledWith({
			plan: ARGS.plan,
			sessionId: 'sess-1',
		});
		expect(result.planPath).toBe(PLAN_PATH);
		expect(result.summary).toContain('never saw the review panel');
	});

	it('marks the session as awaiting a decision, so the refine turn is told to resubmit', async () => {
		const { markSubmitted, submission } = setup();

		await submission.submit({ args: ARGS, origin: ORIGIN });

		expect(markSubmitted).toHaveBeenCalledWith('sess-1');
	});

	it('marks it even when no window showed the review, since the plan still stands', async () => {
		const { markSubmitted, submission } = setup({ hasRenderer: false });

		await submission.submit({ args: ARGS, origin: ORIGIN });

		expect(markSubmitted).toHaveBeenCalledWith('sess-1');
	});

	it('still reviews the plan when the file could not be written', async () => {
		const { reviews, submission } = setup({ writeFails: true });

		const result = await submission.submit({ args: ARGS, origin: ORIGIN });

		expect(reviews[0]?.planPath).toBeNull();
		expect(result.planPath).toBeNull();
		expect(result.summary).toContain('could not be saved');
	});
});
