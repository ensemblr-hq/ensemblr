import { describe, expect, it } from 'vitest';

import {
	buildConciergeMessage,
	CONCIERGE_MESSAGE_REASONS,
	type ConciergeMessageSender,
} from '../../src/shared/agent-control.ts';

const sender = (
	overrides: Partial<ConciergeMessageSender> = {},
): ConciergeMessageSender => ({
	agentSessionId: 'sess-1',
	tabTitle: 'Linear OAuth callback',
	workspaceId: 'ws-1',
	workspaceName: 'fix-linear-oauth-callback',
	...overrides,
});

// The Concierge reads this in the same composer the user types into, and acts on
// other workspaces off the back of it. Everything below is about that: it has to
// be able to tell an agent from the human, know which workspace is speaking, and
// know whether this message is asking anything of it.
describe('the message an agent sends the Concierge', () => {
	it('says it is from an agent rather than from the user', () => {
		const rendered = buildConciergeMessage({
			message: 'The API key is missing from the environment.',
			reason: 'blocked',
			sender: sender(),
		});

		expect(rendered).toContain('MESSAGE FROM AN AGENT');
		expect(rendered).toContain('This is not the user speaking');
	});

	it('names the workspace and the tab it came from', () => {
		const rendered = buildConciergeMessage({
			message: 'Done.',
			reason: 'done',
			sender: sender(),
		});

		expect(rendered).toContain('"Linear OAuth callback"');
		expect(rendered).toContain('fix-linear-oauth-callback');
	});

	it('falls back to the workspace id when nothing has a name yet', () => {
		const rendered = buildConciergeMessage({
			message: 'Done.',
			reason: 'done',
			sender: sender({ tabTitle: null, workspaceName: null }),
		});

		expect(rendered).toContain('ws-1');
	});

	// The ids are the whole point of the header: without them the Concierge knows
	// something happened somewhere and has nothing to address a follow-up to.
	it('carries the ids a follow-up needs', () => {
		const rendered = buildConciergeMessage({
			message: 'Blocked.',
			reason: 'blocked',
			sender: sender(),
		});

		expect(rendered).toContain('sess-1');
		expect(rendered).toContain('ws-1');
		expect(rendered).toContain('ensemblr_send_follow_up');
	});

	it('keeps the agent’s own prose intact below a separator', () => {
		const message = 'Line one.\n\nLine two, with `code` in it.';
		const rendered = buildConciergeMessage({
			message,
			reason: 'progress',
			sender: sender(),
		});

		expect(rendered.endsWith(message)).toBe(true);
		expect(rendered).toContain('\n---\n');
	});

	// A progress note that reads like a request is how a supervisor ends up doing
	// a turn of work nobody asked for, on every heartbeat from every workspace.
	it('tells the Concierge that a progress note wants nothing back', () => {
		const rendered = buildConciergeMessage({
			message: 'Two of four files migrated.',
			reason: 'progress',
			sender: sender(),
		});

		expect(rendered).toContain('Nothing is being asked of you');
	});

	// "Finished" is the agent's own account of its work. The Concierge supervises
	// rather than trusts, and the header is where that starts.
	it('tells the Concierge to verify a finished claim rather than believe it', () => {
		const rendered = buildConciergeMessage({
			message: 'The migration is complete.',
			reason: 'done',
			sender: sender(),
		});

		expect(rendered).toContain('ensemblr_get_last_message');
	});

	it('renders every reason with its own headline and its own guidance', () => {
		const rendered = CONCIERGE_MESSAGE_REASONS.map((reason) =>
			buildConciergeMessage({ message: 'body', reason, sender: sender() }),
		);

		expect(new Set(rendered).size).toBe(CONCIERGE_MESSAGE_REASONS.length);
		for (const text of rendered) {
			expect(text).not.toContain('undefined');
		}
	});
});
