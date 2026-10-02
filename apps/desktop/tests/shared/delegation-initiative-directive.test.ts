import { describe, expect, it } from 'vitest';

import {
	buildDelegationInitiativeDirective,
	DELEGATION_ON_REQUEST_HEADER,
} from '../../src/shared/agent-control.ts';

const ORCHESTRATOR = {
	delegation: 'ensemblr',
	initiative: 'on-request',
	role: 'orchestrator',
	unattended: false,
} as const;

describe('delegation initiative directive', () => {
	it('says nothing while the judgement is left to the agent', () => {
		expect(
			buildDelegationInitiativeDirective({
				...ORCHESTRATOR,
				initiative: 'automatic',
			}),
		).toBeNull();
	});

	it('opens with the header a test can locate it by', () => {
		expect(buildDelegationInitiativeDirective(ORCHESTRATOR)).toContain(
			DELEGATION_ON_REQUEST_HEADER,
		);
	});

	// The point of the mode: an unattended run has nobody to ask, so holding it
	// back would strand the run this app turns AFK on to keep moving.
	it('never reaches an unattended turn', () => {
		expect(
			buildDelegationInitiativeDirective({
				...ORCHESTRATOR,
				unattended: true,
			}),
		).toBeNull();
	});

	// A leaf already has the spawn ops denied, so the block would describe a
	// restriction it is under twice over.
	it('never reaches a sub-agent, which cannot delegate anyway', () => {
		expect(
			buildDelegationInitiativeDirective({
				...ORCHESTRATOR,
				role: 'subagent',
			}),
		).toBeNull();
	});

	// Dispatching work to workspaces is the Concierge's one job, and it has no
	// workspace to do that work in instead.
	it('never reaches the Concierge, whose whole job is handing work out', () => {
		expect(
			buildDelegationInitiativeDirective({
				...ORCHESTRATOR,
				role: 'concierge',
			}),
		).toBeNull();
	});

	it('names what lifts it, so an explicit ask is still answerable', () => {
		const directive = buildDelegationInitiativeDirective(ORCHESTRATOR) ?? '';

		expect(directive).toContain('delegate this');
		expect(directive).toContain('role playbook');
	});

	// Without this the block trades one failure for another: an agent that will
	// not delegate and will not say why simply runs out of room.
	it('asks for an offer rather than silence when the window fills', () => {
		const directive = buildDelegationInitiativeDirective(ORCHESTRATOR) ?? '';

		expect(directive).toContain('context window');
		expect(directive).toContain('offer');
	});

	it('names the spawn op an Ensemblr-delegating root actually holds', () => {
		expect(buildDelegationInitiativeDirective(ORCHESTRATOR)).toContain(
			'ensemblr_start_conversation',
		);
	});

	// A native root has the Ensemblr spawn ops withheld rather than discouraged,
	// so naming one would send it hunting for a tool it does not have.
	it('names no withheld op to a root delegating through its own runtime', () => {
		const directive =
			buildDelegationInitiativeDirective({
				...ORCHESTRATOR,
				delegation: 'native',
			}) ?? '';

		expect(directive).toContain("runtime's own sub-agent tool");
		expect(directive).not.toContain('ensemblr_start_conversation');
	});
});
