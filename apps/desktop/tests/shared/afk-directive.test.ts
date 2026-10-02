import { describe, expect, it } from 'vitest';
import { afkModeControlOpDenial } from '../../src/shared/afk-mode.ts';
import {
	AFK_DIRECTIVE_HEADER,
	AGENT_CONTROL_OPS,
	buildAfkDirective,
} from '../../src/shared/agent-control.ts';

describe('afk directive', () => {
	it('renders nothing while the user is present', () => {
		expect(buildAfkDirective(false)).toBeNull();
	});

	it('opens with the header a test can locate it by', () => {
		expect(buildAfkDirective(true)).toContain(AFK_DIRECTIVE_HEADER);
	});

	// The gate refuses the tool whatever the prompt says, but an agent that reads
	// nothing about it spends the turn discovering that by trial.
	it('names the refused tool and what replaces it', () => {
		const directive = buildAfkDirective(true) ?? '';

		expect(directive).toContain('ensemblr_ask_user_question');
		expect(directive).toContain('assumption');
		expect(directive).toContain('final message');
	});

	// The confirmations AFK answers are the ones a human would otherwise have
	// caught, so the block has to say what the agent is now solely responsible for.
	it('states the limits that replace the confirmations it answers', () => {
		const directive = buildAfkDirective(true) ?? '';

		expect(directive).toContain('Permission confirmations');
		expect(directive).toContain('hard to reverse');
	});
});

describe('afk control-op policy', () => {
	// Held as an explicit list rather than derived: adding an op to
	// `AGENT_CONTROL_OPS` should fail this until someone decides whether it parks
	// the turn on a human.
	const BLOCKED = new Set(['askUserQuestion']);

	it('refuses exactly the ops that wait on a human', () => {
		const refused = AGENT_CONTROL_OPS.filter(
			(op) => afkModeControlOpDenial(op) !== null,
		);

		expect(new Set(refused)).toEqual(BLOCKED);
	});

	it('gives the refusal an escape hatch rather than only a cause', () => {
		const denial = afkModeControlOpDenial('askUserQuestion') ?? '';

		expect(denial).toContain('they are away');
		expect(denial).toContain('Decide it yourself');
	});
});
