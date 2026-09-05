import { describe, expect, it } from 'vitest';

import {
	buildPeerBriefDirective,
	PEER_BRIEF_HEADER,
	spawnedChildRole,
} from '../../src/shared/agent-control.ts';

// Nothing in the app arbitrates two agents writing one checkout, so this block is
// the whole of what stops them colliding. It has to say who commits, where the
// peer's half ends, and who to ask at the boundary — an instruction to "tell the
// other orchestrator" with no session id is an instruction to go looking.
describe('the contract a peer orchestrator opens with', () => {
	it('says it is a peer rather than a sub-agent', () => {
		const directive = buildPeerBriefDirective('sess-parent');

		expect(directive).toContain(PEER_BRIEF_HEADER);
		expect(directive).toContain('root orchestrator');
	});

	it('names the spawner as the committer and gives its session id', () => {
		const directive = buildPeerBriefDirective('sess-parent');

		expect(directive).toContain('sess-parent');
		expect(directive).toContain('not the committer');
		expect(directive).toContain('ensemblr_send_follow_up');
	});

	it('names the git commands that move HEAD or the index', () => {
		const directive = buildPeerBriefDirective('sess-parent');

		for (const command of ['git commit', 'git rebase', 'git checkout']) {
			expect(directive).toContain(command);
		}
	});

	it('points at the diff as the way to tell whether a file is free', () => {
		const directive = buildPeerBriefDirective('sess-parent');

		expect(directive).toContain('ensemblr_get_workspace_diff');
	});
});

// Both axes that carry a spawned conversation's role read this one function —
// the registry spends depth on it and the spawn path stamps the durable marker
// from it — so a peer that answered differently to either would get the
// sub-agent policy, which is the one thing it must not have.
describe('the role a spawn opens its child with', () => {
	it('makes a peer a root, exactly as a Concierge child is one', () => {
		expect(spawnedChildRole({ concierge: false, peer: true })).toBe(
			'orchestrator',
		);
		expect(spawnedChildRole({ concierge: true })).toBe('orchestrator');
	});

	it('leaves an ordinary spawn a sub-agent', () => {
		expect(spawnedChildRole({ concierge: false })).toBe('subagent');
		expect(spawnedChildRole({ concierge: false, peer: false })).toBe(
			'subagent',
		);
	});
});
