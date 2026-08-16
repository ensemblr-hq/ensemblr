import { describe, expect, it } from 'vitest';

import {
	buildLinkedIssueDirective,
	LINKED_ISSUE_DIRECTIVE_HEADER,
	type WorkspaceLinkedIssue,
} from '../../src/shared/agent-control.ts';

const issue = (
	overrides: Partial<WorkspaceLinkedIssue> = {},
): WorkspaceLinkedIssue => ({
	accountId: 'acct-1',
	identifier: 'ENG-106',
	provider: 'linear',
	title: 'Expose Linear to agents',
	url: 'https://linear.app/the/issue/ENG-106',
	...overrides,
});

describe('buildLinkedIssueDirective', () => {
	it('renders nothing for a workspace with no linked issue', () => {
		expect(buildLinkedIssueDirective(null)).toBeNull();
	});

	// The control surface has no GitHub issue op at all, so a block naming the
	// obligation would name no tool that could discharge it.
	it('renders nothing for a GitHub-linked workspace', () => {
		expect(buildLinkedIssueDirective(issue({ provider: 'github' }))).toBeNull();
	});

	it('names the issue and the account every write has to be scoped to', () => {
		const directive = buildLinkedIssueDirective(issue()) ?? '';

		expect(directive).toContain(LINKED_ISSUE_DIRECTIVE_HEADER);
		expect(directive).toContain('ENG-106');
		expect(directive).toContain('Expose Linear to agents');
		expect(directive).toContain('acct-1');
	});

	// A workspace created before ADR 0052 recorded no account. The block still has
	// to render — the identifier is the load-bearing half — and must not print an
	// empty accountId the agent would pass back verbatim.
	it('omits the account clause when the workspace recorded none', () => {
		const directive =
			buildLinkedIssueDirective(issue({ accountId: null })) ?? '';

		expect(directive).toContain('ENG-106');
		expect(directive).not.toContain('accountId is');
	});

	it('gives an implementing root all four lifecycle triggers', () => {
		const directive = buildLinkedIssueDirective(issue()) ?? '';

		expect(directive).toContain('ensemblr_linear_get_issue');
		expect(directive).toContain('ensemblr_linear_get_metadata');
		expect(directive).toContain('ensemblr_linear_create_comment');
		expect(directive).toContain('ensemblr_linear_update_issue');
		expect(directive).toContain('In Review');
	});

	// Naming a tool the caller would be refused teaches it to keep reaching for
	// one, which is the whole reason both axes are arguments here.
	it('never sends a sub-agent at the writes its role denies', () => {
		const directive = buildLinkedIssueDirective(issue(), 'subagent') ?? '';

		expect(directive).toContain('ensemblr_linear_get_issue');
		expect(directive).toContain('report');
		expect(directive).toMatch(/refused to a spawned sub-agent/);
	});

	it('leaves a planning root commenting but not moving the ticket', () => {
		const directive =
			buildLinkedIssueDirective(issue(), 'orchestrator', true) ?? '';

		expect(directive).toContain('ensemblr_linear_create_comment');
		expect(directive).toContain(
			'Moving the issue is refused while you are planning',
		);
		expect(directive).not.toContain('AS SOON AS YOU BEGIN');
	});

	// A planning sub-agent is denied both writes, so its role answer has to win
	// over its mode answer rather than the two composing into a half-truth.
	it('answers a planning sub-agent by its role, which denies more', () => {
		const directive =
			buildLinkedIssueDirective(issue(), 'subagent', true) ?? '';

		expect(directive).toMatch(/refused to a spawned sub-agent/);
		expect(directive).not.toContain(
			'Moving the issue is refused while you are planning',
		);
	});
});
