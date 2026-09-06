import { describe, expect, it } from 'vitest';

import {
	CONTROL_ARCHITECTURE_ENABLED,
	CONTROL_ARCHITECTURE_ENV_KEY,
	CONTROL_TUI_HARNESSES_ENABLED,
	CONTROL_TUI_HARNESSES_ENV_KEY,
	TOOL_DEFS,
} from '../../src/main/agent-control/index.ts';
import type { AwarenessFeatures } from '../../src/shared/agent-control.ts';
import {
	ARCHITECTURE_DIAGRAM_OPS,
	ASK_USER_QUESTION_LIMITS,
	CONCIERGE_ONLY_OPS,
	CONCIERGE_WITHHELD_OPS,
	conciergeAwareness,
	conciergeControlOpDenial,
	harnessAwareness,
	nativeOrchestratorAwareness,
	orchestratorAwareness,
	PLAN_MODE_DELEGATION_HEADER,
	PLAN_REFINEMENT_HEADER,
	planModeOrchestratorAwareness,
	planModeSubagentAwareness,
	roleForDepth,
	SESSION_BRIEF_NUDGE_HEADER,
	SUBAGENT_UNUSABLE_OPS,
	SUBAGENT_WITHHELD_OPS,
	subAgentControlOpDenial,
	subagentAwareness,
	TUI_HARNESS_OPS,
	withheldControlOps,
} from '../../src/shared/agent-control.ts';
import { formatConciergeReferenceHref } from '../../src/shared/concierge-references.ts';
import {
	CONCIERGE_GUARDED_TOOLS,
	PLAN_MODE_GUARDED_TOOLS,
	planModeControlOpDenial,
	planModeFollowUpDenial,
} from '../../src/shared/plan-mode.ts';
import {
	controlOpForToolName,
	extractEmbeddedToolDescriptions,
	readExtensionSource,
	readSessionBriefDirectiveFields,
} from './support/pi-extension-source.ts';

/**
 * Each playbook composed with the architecture diagram switched ON, which is the
 * variant every assertion below describes: they are about the whole surface, and
 * the feature-off cuts get their own tests at the end of the file.
 */
const ALL_ON: AwarenessFeatures = {
	architectureDiagram: true,
	tuiHarnesses: true,
};

/** Composes all six playbooks for one feature state, in a fixed order. */
const playbooksFor = (features: AwarenessFeatures) =>
	[
		orchestratorAwareness(features),
		nativeOrchestratorAwareness(features),
		subagentAwareness(features),
		harnessAwareness(features),
		planModeOrchestratorAwareness(features),
		planModeSubagentAwareness(features),
	] as const;

const ORCHESTRATOR_AWARENESS = orchestratorAwareness(ALL_ON);
const NATIVE_ORCHESTRATOR_AWARENESS = nativeOrchestratorAwareness(ALL_ON);
const SUBAGENT_AWARENESS = subagentAwareness(ALL_ON);
const HARNESS_AWARENESS = harnessAwareness(ALL_ON);
const PLAN_MODE_ORCHESTRATOR_AWARENESS = planModeOrchestratorAwareness(ALL_ON);
const PLAN_MODE_SUBAGENT_AWARENESS = planModeSubagentAwareness(ALL_ON);
const CONCIERGE_AWARENESS = conciergeAwareness(ALL_ON);

/** The same six with the diagram off, for the assertions that it leaves no trace. */
const AWARENESS_WITHOUT_DIAGRAM = playbooksFor({
	...ALL_ON,
	architectureDiagram: false,
});

/** The same six with harnesses off, for the assertions that they leave no trace. */
const AWARENESS_WITHOUT_HARNESSES = playbooksFor({
	...ALL_ON,
	tuiHarnesses: false,
});

/**
 * Every corner of the feature space. The embed assertions walk all four rather
 * than the two ends of one axis: a guard wired to the wrong flag composes
 * correctly whenever both agree, so only a mixed corner catches it.
 */
const FEATURE_CORNERS: readonly AwarenessFeatures[] = [
	{ architectureDiagram: true, tuiHarnesses: true },
	{ architectureDiagram: true, tuiHarnesses: false },
	{ architectureDiagram: false, tuiHarnesses: true },
	{ architectureDiagram: false, tuiHarnesses: false },
];

/** Both plan-mode playbooks, for the assertions that hold whatever the role. */
const PLAN_MODE_PLAYBOOKS = [
	PLAN_MODE_ORCHESTRATOR_AWARENESS,
	PLAN_MODE_SUBAGENT_AWARENESS,
] as const;

/**
 * The tool names a root delegating through its own runtime does not hold,
 * derived from the policy rather than restated, so an op added to the axis is
 * covered without editing this file.
 */
const NATIVE_WITHHELD_TOOL_NAMES = ((): readonly string[] => {
	const ops = withheldControlOps({
		// The delegation axis is what this list is about, so the feature axis is
		// held open: an op withheld because the diagram is off is not one the
		// native-absence paragraph has any business naming.
		architectureDiagram: true,
		tuiHarnesses: true,
		delegation: 'native',
		hasChatTab: true,
		role: 'orchestrator',
	});
	// The delegation axis only: the same answer folds in the Concierge-only ops,
	// which a native-delegating root is withheld for a different reason and which
	// the native-absence paragraph has no business naming.
	return TOOL_DEFS.filter(
		(def) => ops.has(def.op) && !CONCIERGE_ONLY_OPS.has(def.op),
	).map((def) => def.name);
})();

/**
 * Reads a named single- or backtick-quoted literal out of the extension source
 * and unescapes it back to its runtime form. The fragments the playbooks
 * interpolate are declared this way, so resolving a substitution means looking
 * one of these up rather than evaluating a file that imports Pi's runtime.
 */
const extractEmbeddedLiteral = (source: string, name: string): string => {
	const backticked = source.match(
		new RegExp(`const ${name} =\\s*\`((?:\\\\.|[^\`\\\\])*)\`;`, 's'),
	);
	if (backticked) {
		return backticked[1]
			.replace(/\\`/g, '`')
			.replace(/\\n/g, '\n')
			.replace(/\\\\/g, '\\');
	}
	const quoted = source.match(
		new RegExp(`const ${name} =\\s*'((?:\\\\.|[^'\\\\])*)';`, 's'),
	);
	if (!quoted) {
		throw new Error(`Could not find the ${name} literal.`);
	}
	return quoted[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
};

/**
 * Extracts one of the extension's playbook builders and composes it for a given
 * feature state, so the embedded copy can be compared against the shared one in
 * both. The builders are template literals over exactly two substitution forms —
 * a `features.<flag> ? … : ''` guard around a quoted clause, and the same guard
 * around a named fragment — and resolving those textually is what keeps the
 * comparison a source read. Every flag on {@link AwarenessFeatures} is resolved
 * by name, so a third one needs no change here.
 * @param source - The extension's raw source.
 * @param name - The builder's declared name.
 * @param features - Which feature state to compose.
 * @returns The composed playbook, byte-for-byte as the extension would build it.
 */
const extractEmbeddedAwareness = (
	source: string,
	name: string,
	features: AwarenessFeatures,
): string => {
	const match = source.match(
		new RegExp(
			`const ${name} = \\(\\s*features: AwarenessFeatures,?\\s*\\): string =>\\s*\`((?:\\\\.|[^\`\\\\])*)\`;`,
			's',
		),
	);
	if (!match) {
		throw new Error(`Could not find the ${name} playbook builder.`);
	}
	/** Reads a guard's flag off the composed feature state, refusing an unknown one. */
	const flagValue = (flag: string): boolean => {
		if (!(flag in features)) {
			throw new Error(`${name} guards on an unknown feature flag: ${flag}.`);
		}
		return features[flag as keyof AwarenessFeatures];
	};
	const body = match[1]
		.replace(/\\`/g, '`')
		.replace(/\\\\/g, '\\')
		.replace(
			/\$\{features\.(\w+) \? '((?:\\.|[^'\\])*)' : ''\}/g,
			(_whole, flag: string, clause: string) => (flagValue(flag) ? clause : ''),
		)
		.replace(
			/\$\{features\.(\w+) \? ([A-Z_]+) : ''\}/g,
			(_whole, flag: string, fragment: string) =>
				flagValue(flag) ? extractEmbeddedLiteral(source, fragment) : '',
		);
	if (body.includes('${')) {
		throw new Error(`Unresolved substitution left in ${name}.`);
	}
	return body;
};

/**
 * Extracts the string members of a `const <name> = new Set([...])` literal in
 * the extension source, so a guarded-tool set can be compared against the shared
 * one member-for-member regardless of formatting.
 */
const extractEmbeddedStringSet = (source: string, name: string): string[] => {
	const match = source.match(
		new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`, 's'),
	);
	if (!match) {
		throw new Error(`Could not find the ${name} Set literal.`);
	}
	return [...match[1].matchAll(/['"]([^'"]+)['"]/g)]
		.map((entry) => entry[1])
		.sort();
};

/**
 * Reads a numeric JSON-schema constraint off a named field in the extension's
 * tool parameter schemas, so a limit the app enforces server-side can be
 * asserted to also travel to the model as a machine-readable bound.
 */
const extractSchemaConstraint = (
	source: string,
	field: string,
	constraint: string,
): number => {
	const declaration = `${field}: Type\\.(?:Optional\\(\\s*Type\\.)?String\\(\\{`;
	const match = source.match(
		new RegExp(`${declaration}[^}]*${constraint}: (\\d+)`, 's'),
	);
	if (!match) {
		throw new Error(`Could not find ${constraint} on the ${field} schema.`);
	}
	return Number(match[1]);
};

/**
 * Tools whose description is allowed to differ between the two surfaces, because
 * it names something only one species has. `setBranchName` closes by pointing at
 * the tab-naming tool a Pi agent should use instead — advice a harness cannot
 * follow, since it owns a terminal tab that titles itself from its session log.
 * Everything absent from this set must match byte-for-byte.
 */
const SPECIES_SPECIFIC_DESCRIPTIONS: ReadonlySet<string> = new Set([
	'ensemblr_set_branch_name',
]);

describe('agent-control AWARENESS parity', () => {
	it('embeds the orchestrator variant byte-for-byte in the Pi extension', () => {
		const source = readExtensionSource();
		for (const features of FEATURE_CORNERS) {
			expect(
				extractEmbeddedAwareness(source, 'ORCHESTRATOR_AWARENESS', features),
			).toBe(orchestratorAwareness(features));
		}
	});

	it('embeds the sub-agent variant byte-for-byte in the Pi extension', () => {
		const source = readExtensionSource();
		for (const features of FEATURE_CORNERS) {
			expect(
				extractEmbeddedAwareness(source, 'SUBAGENT_AWARENESS', features),
			).toBe(subagentAwareness(features));
		}
	});

	// The native variant is the playbook for a root whose runtime delegates
	// through its own sub-agent tool. Its tool list has the chat-tab spawn ops
	// withheld, so it may name one only in the sentence that says the tool is
	// gone — anywhere else sends it hunting for a tool it does not hold. Scoped
	// by paragraph rather than by substring so rewording the inventory cannot
	// quietly reintroduce one.
	it('names a withheld spawn tool only where it says the tool is absent', () => {
		const paragraphs = NATIVE_ORCHESTRATOR_AWARENESS.split('\n\n');
		const absence = paragraphs.filter((paragraph) =>
			paragraph.includes(
				'absent from your list rather than merely discouraged',
			),
		);

		expect(absence).toHaveLength(1);
		expect(NATIVE_WITHHELD_TOOL_NAMES.length).toBeGreaterThan(0);
		expect(NATIVE_ORCHESTRATOR_AWARENESS).toContain(
			"YOUR OWN runtime's sub-agent tool",
		);
		for (const name of NATIVE_WITHHELD_TOOL_NAMES) {
			expect(absence[0], name).toContain(name);
			for (const paragraph of paragraphs) {
				if (paragraph === absence[0]) continue;
				expect(paragraph, name).not.toContain(name);
			}
		}
	});

	// Everything that is a property of the work rather than of the mechanism has
	// to survive the swap, or picking the built-in tool quietly drops the rules
	// that make a fan-out worth doing.
	it('keeps the mechanism-independent rules in the native variant', () => {
		expect(NATIVE_ORCHESTRATOR_AWARENESS).toContain(
			'Your last message is your answer to the user',
		);
		expect(NATIVE_ORCHESTRATOR_AWARENESS).toContain(
			'Split the work before you split the agents',
		);
		expect(NATIVE_ORCHESTRATOR_AWARENESS).toContain('Verify before you rely');
		expect(NATIVE_ORCHESTRATOR_AWARENESS).toContain(
			'`ensemblr_ask_user_question`',
		);
	});

	// A sub-agent that writes its findings mid-turn and signs off with a pointer
	// ("report delivered above") hands its orchestrator an empty hand-off line, so
	// the playbook has to name that failure and forbid it outright.
	it('binds a sub-agent to deliver its whole report in its final turn', () => {
		expect(SUBAGENT_AWARENESS).toContain('Your last message is your report');
		expect(SUBAGENT_AWARENESS).toContain('never a pointer to work');
		expect(SUBAGENT_AWARENESS).toContain('Produce nothing after it');
	});

	it('tells the orchestrator a wait hands back the child’s whole final turn', () => {
		expect(ORCHESTRATOR_AWARENESS).toContain('whole final turn');
	});

	// The app renders a turn as one collapsed activity row plus the prose that
	// follows the last tool call, so an orchestrator that writes its report and
	// then files bookkeeping buries the report inside the row the user has to
	// expand. The playbook has to order the calls before the answer, and forbid
	// the pointer sign-off that is all the user would otherwise see.
	it('binds the orchestrator to write its user-facing answer after every tool call', () => {
		expect(ORCHESTRATOR_AWARENESS).toContain(
			'Your last message is your answer to the user',
		);
		expect(ORCHESTRATOR_AWARENESS).toContain(
			'Finish every tool call before you write it',
		);
		expect(ORCHESTRATOR_AWARENESS).toContain('never a pointer to work');
		expect(ORCHESTRATOR_AWARENESS).toContain('Produce nothing after it');
	});

	// The rule has to land before the delegation loop tells it to integrate the
	// outcomes into its answer, or the step that produces the answer is read
	// before the rule governing when to write it.
	it('states the answer-last rule before the delegation loop', () => {
		expect(
			ORCHESTRATOR_AWARENESS.indexOf('your answer to the user'),
		).toBeLessThan(
			ORCHESTRATOR_AWARENESS.indexOf('When delegation is warranted'),
		);
	});

	// A brief that names only the topic leaves the child to invent its own
	// deliverable, which is how a fan-out came back with an unrequested 9KB
	// markdown file nobody asked for and nobody diffed.
	it('binds every delegating role to brief a child with its deliverable', () => {
		for (const playbook of [ORCHESTRATOR_AWARENESS, HARNESS_AWARENESS]) {
			expect(playbook).toContain('what to deliver, not just what to look at');
			expect(playbook).toContain('reports inline');
		}
	});

	// The sub-agent report structure invites parking open questions until the end,
	// so without a stated scope a child reads "produce a reference" as a file to
	// write rather than a report to give.
	it('makes a sub-agent report rather than leave artifacts behind', () => {
		expect(SUBAGENT_AWARENESS).toContain('Your report is the deliverable');
		expect(SUBAGENT_AWARENESS).toContain('unless your brief names a path');
	});

	// Children reliably decline to interrupt with `need_decision`, whatever the
	// playbook says — two test runs with textbook setups produced zero signals. So
	// the question travels in the report under a heading the orchestrator can find,
	// and the signal is reserved for a child that genuinely cannot proceed.
	it('routes a sub-agent role open decision into its report', () => {
		for (const playbook of [SUBAGENT_AWARENESS, PLAN_MODE_SUBAGENT_AWARENESS]) {
			expect(playbook).toContain('`Open questions` heading');
			expect(playbook).toContain('2-6 concrete options');
			expect(playbook).toContain('cannot');
		}
	});

	// The other half: a section no orchestrator reads is a decision shipped as a
	// silent default. Pi orchestrators own a questionnaire tool and must use it;
	// a planning orchestrator folds the same questions into its interview.
	it('binds every Pi orchestrator to put the gathered questions to the user', () => {
		for (const playbook of [
			ORCHESTRATOR_AWARENESS,
			PLAN_MODE_ORCHESTRATOR_AWARENESS,
		]) {
			expect(playbook).toContain('`Open questions`');
			expect(playbook).toContain('ensemblr_ask_user_question');
		}
		expect(ORCHESTRATOR_AWARENESS).toContain('silent default');
		expect(PLAN_MODE_ORCHESTRATOR_AWARENESS).toContain('quietly close');
	});

	// A wait returning no signal used to imply nothing needed asking. Under the
	// report-and-batch design that inference is exactly backwards.
	it('warns the orchestrator that a signal-free wait still carries questions', () => {
		expect(ORCHESTRATOR_AWARENESS).toContain(
			'does not mean nothing needs asking',
		);
	});

	// Observed: an orchestrator pasted four files' contents into a brief and the
	// child re-opened all four anyway, undoing the saving the scout read bought.
	// The orchestrator half of that rule is useless without this half.
	it('tells every sub-agent role to work from what its brief already gave it', () => {
		for (const playbook of [SUBAGENT_AWARENESS, PLAN_MODE_SUBAGENT_AWARENESS]) {
			expect(playbook).toContain('Work from the brief');
			expect(playbook).toContain('already paid for');
		}
	});

	// A child doing real work outlives the capped wait window routinely, so every
	// orchestrator meets `timedOut: true` and must read it as a lap of the loop
	// rather than a fault to report or a child to re-spawn.
	it('tells every delegating role that a timed-out wait is not a fault', () => {
		for (const playbook of [
			ORCHESTRATOR_AWARENESS,
			HARNESS_AWARENESS,
			PLAN_MODE_ORCHESTRATOR_AWARENESS,
		]) {
			expect(playbook).toContain('timedOut: true');
			expect(playbook).toContain('not a fault');
		}
	});

	// Three children cold-starting on one repo read the same files three times,
	// which is what makes a fan-out cost more context than doing the work inline.
	it('tells every delegating role to establish shared ground before fanning out', () => {
		for (const playbook of [
			ORCHESTRATOR_AWARENESS,
			HARNESS_AWARENESS,
			PLAN_MODE_ORCHESTRATOR_AWARENESS,
		]) {
			expect(playbook).toContain('Split the work before you split the');
			expect(playbook).toContain('paid for twice');
		}
	});

	it('offers the orchestrator the brief report mode a wide fan-out needs', () => {
		expect(ORCHESTRATOR_AWARENESS).toContain('reports: "brief"');
		expect(ORCHESTRATOR_AWARENESS).toContain('ensemblr_get_last_message');
	});

	// Nothing else in the loop prompts a check, so a cited claim flows into the
	// answer — or into a plan — feeling verified because a child cited a path.
	it('tells both orchestrator roles to check a load-bearing claim themselves', () => {
		for (const playbook of [
			ORCHESTRATOR_AWARENESS,
			PLAN_MODE_ORCHESTRATOR_AWARENESS,
		]) {
			expect(playbook).toContain('Verify before you rely');
			expect(playbook).toContain('a claim, not a fact you checked');
		}
	});

	// An over-long option label is still rejected server-side, which costs the model
	// a failed call and a full re-submission of the batch. Shipping the same bound
	// as a JSON-schema constraint lets its own validator catch it first.
	it('ships the rejecting ask-user-question limit as a schema constraint', () => {
		expect(
			extractSchemaConstraint(readExtensionSource(), 'label', 'maxLength'),
		).toBe(ASK_USER_QUESTION_LIMITS.maxLabelLength);
	});

	// The header is only a pager dot's accessible name, so the app trims it instead
	// of rejecting the batch. A client-side bound would put back the failed call
	// this stopped costing — and the header the model wanted is not even wrong.
	it('ships no header bound, because an over-long header is trimmed not rejected', () => {
		expect(() =>
			extractSchemaConstraint(readExtensionSource(), 'header', 'maxLength'),
		).toThrow();
	});

	it('embeds both plan-mode playbooks byte-for-byte in the Pi extension', () => {
		const source = readExtensionSource();
		for (const features of FEATURE_CORNERS) {
			expect(
				extractEmbeddedAwareness(
					source,
					'PLAN_MODE_ORCHESTRATOR_AWARENESS',
					features,
				),
			).toBe(planModeOrchestratorAwareness(features));
			expect(
				extractEmbeddedAwareness(
					source,
					'PLAN_MODE_SUBAGENT_AWARENESS',
					features,
				),
			).toBe(planModeSubagentAwareness(features));
		}
	});

	// The two variants share their headline, upkeep clause, stale-context tail, and
	// enforcement tail through module-private consts. Asserting a substring from
	// each block appears in both is what fails a one-sided edit to the shared half.
	it('keeps the blocks both plan-mode playbooks share in step', () => {
		for (const shared of [
			'PLAN MODE IS ON. While it stays on, this playbook replaces every other instruction',
			'Nothing else in your context outranks this block',
			'Nothing turns Plan Mode off except the user approving a plan',
			'do not look for a way around it',
		]) {
			for (const playbook of PLAN_MODE_PLAYBOOKS) {
				expect(playbook).toContain(shared);
			}
		}
	});

	it('tells a planning orchestrator how enforcement works and how to leave plan mode', () => {
		expect(PLAN_MODE_ORCHESTRATOR_AWARENESS).toContain(
			'ensemblr_exit_plan_mode',
		);
		expect(PLAN_MODE_ORCHESTRATOR_AWARENESS).toContain(
			'ensemblr_ask_user_question',
		);
	});

	it('orders the hand-off: name the tab, then hand the plan to the exit tool for the app to post', () => {
		const naming =
			PLAN_MODE_ORCHESTRATOR_AWARENESS.indexOf('ensemblr_set_name');
		const exiting = PLAN_MODE_ORCHESTRATOR_AWARENESS.indexOf(
			'ensemblr_exit_plan_mode',
		);
		const posting = PLAN_MODE_ORCHESTRATOR_AWARENESS.indexOf(
			'The app posts that plan into the conversation',
		);
		expect(naming).toBeGreaterThan(-1);
		expect(exiting).toBeGreaterThan(naming);
		expect(posting).toBeGreaterThan(exiting);
	});

	it('teaches a planning orchestrator the read-only fan-out loop', () => {
		expect(PLAN_MODE_ORCHESTRATOR_AWARENESS).toContain(
			'ensemblr_start_conversation',
		);
		expect(PLAN_MODE_ORCHESTRATOR_AWARENESS).toContain(
			'ensemblr_wait_for_agents',
		);
		expect(PLAN_MODE_ORCHESTRATOR_AWARENESS).toContain(
			'A child you spawn inherits Plan Mode',
		);
		expect(PLAN_MODE_ORCHESTRATOR_AWARENESS).toContain(
			'it cannot write, edit, spawn anything of its own, or talk to the user',
		);
	});

	it('orders fan-out before the plan hand-off, so findings can reach the plan', () => {
		const fanOut = PLAN_MODE_ORCHESTRATOR_AWARENESS.indexOf(
			'Finding those facts does not have to be serial',
		);
		const handOff = PLAN_MODE_ORCHESTRATOR_AWARENESS.indexOf(
			'When you and the user share an understanding',
		);
		expect(fanOut).toBeGreaterThan(-1);
		expect(handOff).toBeGreaterThan(fanOut);
	});

	it('tells a planning sub-agent to investigate and report, not plan or ask', () => {
		expect(PLAN_MODE_SUBAGENT_AWARENESS).toContain(
			'Your last message is your report',
		);
		expect(PLAN_MODE_SUBAGENT_AWARENESS).toContain('Do not write the plan');
		expect(PLAN_MODE_SUBAGENT_AWARENESS).toContain(
			'You do not talk to the user',
		);
		expect(PLAN_MODE_SUBAGENT_AWARENESS).toContain(
			'ensemblr_exit_plan_mode` is not yours to call',
		);
		expect(PLAN_MODE_SUBAGENT_AWARENESS).toContain(
			'ensemblr_notify_orchestrator',
		);
	});

	it('orders the sub-agent turn: name the tab, then read, then report', () => {
		const naming = PLAN_MODE_SUBAGENT_AWARENESS.indexOf('ensemblr_set_name');
		const reading = PLAN_MODE_SUBAGENT_AWARENESS.indexOf('Read, do not guess');
		const reporting = PLAN_MODE_SUBAGENT_AWARENESS.indexOf(
			'Your last message is your report',
		);
		expect(naming).toBeGreaterThan(-1);
		expect(reading).toBeGreaterThan(naming);
		expect(reporting).toBeGreaterThan(reading);
	});

	it('tells a planning agent an imperative prompt is the subject, not consent', () => {
		expect(PLAN_MODE_ORCHESTRATOR_AWARENESS).toContain('SUBJECT of the plan');
		expect(PLAN_MODE_SUBAGENT_AWARENESS).toContain(
			'SUBJECT of your investigation',
		);
		for (const playbook of PLAN_MODE_PLAYBOOKS) {
			expect(playbook).toContain('not permission to start building');
		}
	});

	it('stands alone: each planning agent gets its own intro and tool inventory', () => {
		for (const playbook of PLAN_MODE_PLAYBOOKS) {
			expect(playbook).toContain('You are running inside Ensemblr');
			expect(playbook).toContain('ensemblr_set_name');
			expect(playbook).toContain('ensemblr_focus_tab');
		}
	});

	it('carries none of the implement-first guidance it would contradict', () => {
		for (const playbook of PLAN_MODE_PLAYBOOKS) {
			expect(playbook).not.toContain('Do the work yourself by default');
		}
	});

	it('never offers a planning sub-agent the delegation loop it cannot reach', () => {
		expect(PLAN_MODE_SUBAGENT_AWARENESS).not.toContain(
			'ensemblr_wait_for_agents',
		);
		expect(PLAN_MODE_SUBAGENT_AWARENESS).toContain(
			'Do NOT spawn further sub-agents',
		);
	});

	it('names the tools blocked for either role, which the guard really denies', () => {
		for (const toolName of [
			'ensemblr_launch_harness',
			'ensemblr_start_terminal',
			'ensemblr_write_terminal',
		]) {
			for (const playbook of PLAN_MODE_PLAYBOOKS) {
				expect(playbook).toContain(toolName);
			}
			for (const role of ['orchestrator', 'subagent'] as const) {
				expect(
					planModeControlOpDenial(controlOpForToolName(toolName), role),
				).not.toBeNull();
			}
		}
	});

	it('names the delegation tools a planning sub-agent may not reach, which the guard denies', () => {
		for (const toolName of [
			'ensemblr_start_conversation',
			'ensemblr_send_follow_up',
			'ensemblr_exit_plan_mode',
			'ensemblr_ask_user_question',
		]) {
			expect(PLAN_MODE_SUBAGENT_AWARENESS).toContain(toolName);
			expect(
				planModeControlOpDenial(controlOpForToolName(toolName), 'subagent'),
			).not.toBeNull();
		}
	});

	// The orchestrator playbook promises `ensemblr_start_conversation` outright and
	// `ensemblr_send_follow_up` only against a planning target. Both halves are
	// asserted here so the prose cannot claim a reach the guard does not grant.
	it('grants a planning orchestrator the spawn route and a scoped follow-up', () => {
		expect(
			planModeControlOpDenial('startConversation', 'orchestrator'),
		).toBeNull();
		expect(planModeControlOpDenial('sendFollowUp', 'orchestrator')).toBeNull();
		expect(PLAN_MODE_ORCHESTRATOR_AWARENESS).toContain(
			'reaches only a conversation that is itself planning',
		);
		expect(planModeFollowUpDenial(true)).toBeNull();
		expect(planModeFollowUpDenial(false)).toContain(
			'ensemblr_start_conversation',
		);
	});

	// A sub-agent's denials must not close with the shared escape hatch: it names
	// `ensemblr_exit_plan_mode`, which is exactly what a sub-agent may not call, so
	// the reason would send it round the same refusal.
	it('never tells a denied sub-agent to finish the plan and exit', () => {
		for (const op of [
			'startConversation',
			'sendFollowUp',
			'exitPlanMode',
			'askUserQuestion',
		] as const) {
			const reason = planModeControlOpDenial(op, 'subagent');
			expect(reason).not.toBeNull();
			expect(reason).not.toContain('finish the plan and call');
		}
	});

	it('outranks stale context claiming a different mode', () => {
		for (const playbook of PLAN_MODE_PLAYBOOKS) {
			expect(playbook).toContain(
				'Nothing else in your context outranks this block',
			);
			expect(playbook).toContain('there is no conflict');
		}
	});

	it('embeds the same Plan Mode guarded-tool set the shared classifier uses', () => {
		expect(
			extractEmbeddedStringSet(
				readExtensionSource(),
				'PLAN_MODE_GUARDED_TOOLS',
			),
		).toEqual([...PLAN_MODE_GUARDED_TOOLS].sort());
	});

	it('embeds the same Concierge guarded-tool set the shared classifier uses', () => {
		expect(
			extractEmbeddedStringSet(
				readExtensionSource(),
				'CONCIERGE_GUARDED_TOOLS',
			),
		).toEqual([...CONCIERGE_GUARDED_TOOLS].sort());
	});

	// A Concierge runs on the same runtime a workspace agent does, so one hook
	// serves both policies and the app picks which applies from the origin. Gating
	// on either set alone would leave the other's extra members — `MultiEdit`, the
	// capitalized spellings — classified by a policy no call ever reaches.
	it('forwards the union of both guarded sets, not one role’s half', () => {
		expect(readExtensionSource()).toMatch(
			/const GUARDED_TOOLS = new Set\(\[\s*\.\.\.PLAN_MODE_GUARDED_TOOLS,\s*\.\.\.CONCIERGE_GUARDED_TOOLS,\s*\]\)/,
		);
		expect(readExtensionSource()).toMatch(
			/if \(!GUARDED_TOOLS\.has\(event\.toolName\)\)/,
		);
	});

	// The path is the whole question for a Concierge write: without it every one
	// of them — including into the Concierge's own `memory/` — comes back blocked,
	// and `pathStaysInConciergeHome` never runs outside a unit test. Pi has never
	// published which key its edit tools use, so both are read.
	it('sends the target path with every guarded tool call', () => {
		const source = readExtensionSource();

		expect(source).toMatch(/path: input\?\.path \?\? input\?\.file_path,/);
		expect(source).toMatch(
			/invoke\(\s*'checkPlanModeTool',\s*\{\s*command: input\?\.command,\s*path:/,
		);
	});

	it('swaps the role playbook for the plan-mode one rather than stacking both', () => {
		expect(readExtensionSource()).toMatch(
			/planning\s*\?\s*PLAN_MODE_AWARENESS_FOR_ROLE\s*:\s*\(?\s*rolePlaybook\s*\?\?\s*AWARENESS\s*\)?/,
		);
	});

	// The extension holds no Concierge copy on purpose: that playbook has no
	// counterpart here, so the app sends it down with the brief. Without this the
	// Concierge would be served the orchestrator copy and told to work in a
	// workspace it has none of.
	it('prefers the playbook the app sends over its own copies', () => {
		expect(readExtensionSource()).toMatch(/rolePlaybook\s*\?\?\s*AWARENESS/);
		expect(readExtensionSource()).not.toContain('CONCIERGE_AWARENESS');
	});

	// The app renders every one of these blocks and the extension only appends
	// them, so a field added to `GetSessionBriefResult` that nobody splices in
	// here reaches Pi as nothing at all. `readTurnPreamble` joins the same blocks
	// in the same order for the runtimes the app prompts directly; asserting the
	// order pins the two hand-maintained copies of that sequence together.
	it('appends every rendered brief block, in the order the app joins them', () => {
		expect(readExtensionSource()).toMatch(
			/event\.systemPrompt,\s*playbook,\s*nudge,\s*planRefinement,\s*afkDirective,\s*afkWorkflowDirective,\s*languageDirective,\s*issueDirective,/,
		);
	});

	// Every block on `GetSessionBriefResult` is rendered by the app and only
	// appended here, so a field the extension never reads is a directive that
	// silently stops reaching Pi. Holding the contract's keys against the ones the
	// extension destructures is what catches the next one added.
	it('reads every directive the brief contract carries', () => {
		const source = readExtensionSource();
		const fields = readSessionBriefDirectiveFields();

		expect(fields).toContain('issueDirective');
		expect(fields.length).toBeGreaterThanOrEqual(4);
		for (const field of fields) {
			expect(source).toContain(`typeof brief?.${field} === 'string'`);
		}
	});

	it('reads the refinement block off the brief rather than authoring one', () => {
		const source = readExtensionSource();
		expect(source).toMatch(
			/planRefinement:\s*\n?\s*typeof brief\?\.planRefinement === 'string'/,
		);
		expect(source).not.toContain(PLAN_REFINEMENT_HEADER);
	});

	// The delegation directive answers instructions only Claude Code carries, and
	// it rides `readTurnPreamble`, which Pi never reaches. A copy in the extension
	// would put a block about the `AgentTool` in front of a runtime that has none.
	it('carries no copy of the plan-mode delegation directive', () => {
		expect(readExtensionSource()).not.toContain(PLAN_MODE_DELEGATION_HEADER);
	});

	// One read of the role env var feeds both the role playbook and the plan-mode
	// one, so the two axes of the 2x2 cannot disagree about which half applies.
	it('resolves the role once, so both playbook axes agree', () => {
		const matches = readExtensionSource().match(
			/ENSEMBLR_CONTROL_ROLE === 'subagent'/g,
		);
		expect(matches).toHaveLength(1);
	});

	it('leaves the naming ops available while planning and says so', () => {
		for (const toolName of [
			'ensemblr_set_name',
			'ensemblr_set_branch_name',
			'ensemblr_set_summary',
		]) {
			for (const playbook of PLAN_MODE_PLAYBOOKS) {
				expect(playbook).toContain(toolName);
			}
			for (const role of ['orchestrator', 'subagent'] as const) {
				expect(
					planModeControlOpDenial(controlOpForToolName(toolName), role),
				).toBeNull();
			}
		}
	});

	it('tells a planning agent the upkeep block is the one thing that outranks nothing', () => {
		for (const playbook of PLAN_MODE_PLAYBOOKS) {
			expect(playbook).toContain(SESSION_BRIEF_NUDGE_HEADER);
		}
	});

	// The upkeep block is built from live state, so it has no literal the parity
	// extractor could compare. Rendering it in the app and shipping the finished
	// string in the brief is what keeps it single-sourced — a copy that drifted
	// into the extension would be invisible to every other test here.
	it('never embeds the dynamic upkeep block, which the app renders', () => {
		const source = readExtensionSource();
		expect(source).not.toContain('buildSessionBriefNudge');
		expect(source).not.toContain(`const ${SESSION_BRIEF_NUDGE_HEADER}`);
		expect(source).toContain('getSessionBrief');
	});

	it('teaches the orchestrator the wait-based delegation loop', () => {
		expect(ORCHESTRATOR_AWARENESS).toContain('ensemblr_wait_for_agents');
		expect(ORCHESTRATOR_AWARENESS).toContain('ensemblr_notify_orchestrator');
	});

	it('tells sub-agents to do the work themselves and escalate, not fan out', () => {
		expect(SUBAGENT_AWARENESS).toContain('Do NOT spawn further sub-agents');
		expect(SUBAGENT_AWARENESS).toContain('ensemblr_notify_orchestrator');
		expect(SUBAGENT_AWARENESS).not.toContain('ensemblr_wait_for_agents');
	});

	// The `git.renameWorkspaceOnBranch` setting gates `ensemblr_set_branch_name`,
	// but a playbook is static and cannot see it. Only the per-turn upkeep block,
	// which is built from live state and already honours the setting, may tell an
	// agent to name the branch — otherwise an opted-out user's agent is ordered to
	// call a tool that will refuse it.
	it('never orders branch naming from a static playbook, which cannot see the setting', () => {
		for (const playbook of [
			ORCHESTRATOR_AWARENESS,
			SUBAGENT_AWARENESS,
			...PLAN_MODE_PLAYBOOKS,
		]) {
			expect(playbook).not.toContain('Name the tab and the branch');
			expect(playbook).not.toContain('name the workspace and branch on your');
		}
	});

	it('defers branch naming to the upkeep block in both orchestrator playbooks', () => {
		expect(ORCHESTRATOR_AWARENESS).toContain(
			'it is what asks for the workspace and branch',
		);
		expect(PLAN_MODE_ORCHESTRATOR_AWARENESS).toContain(
			'If the upkeep block also asks for the workspace and branch',
		);
	});

	// Deferring to the block is a routing rule, not a warning. Told the tool
	// refuses when unprompted, an agent asked by the USER to rename a branch
	// concludes the tool is closed to it and reaches for `git branch -m`, which
	// moves the branch behind the app and desyncs the workspace row from git.
	it('frames the branch tool as available rather than as one that refuses', () => {
		expect(ORCHESTRATOR_AWARENESS).not.toContain('unprompted it will refuse');
		expect(ORCHESTRATOR_AWARENESS).toContain('userRequested: true');
		expect(ORCHESTRATOR_AWARENESS).toContain('git branch -m');
		expect(HARNESS_AWARENESS).toContain('userRequested: true');
		expect(HARNESS_AWARENESS).toContain('git branch -m');
	});

	// The workspace name describes the whole body of work, so `setBranchName`
	// refuses a spawned child and the session brief withholds its branch bullet.
	// A playbook that still listed the tool would send a child hunting for a call
	// it cannot make — the same reason the harness variant omits Pi-only tools.
	it('withholds workspace naming from both sub-agent playbooks', () => {
		for (const playbook of [SUBAGENT_AWARENESS, PLAN_MODE_SUBAGENT_AWARENESS]) {
			expect(playbook).not.toContain('the upkeep reminder asks for it');
			expect(playbook).not.toContain(
				'If the upkeep block also asks for the workspace and branch',
			);
		}
		expect(SUBAGENT_AWARENESS).toContain('is refused here');
		expect(PLAN_MODE_SUBAGENT_AWARENESS).toContain('is refused here');
	});

	it('treats only the root as orchestrator; every descendant is a sub-agent', () => {
		expect(roleForDepth(0)).toBe('orchestrator');
		expect(roleForDepth(1)).toBe('subagent');
		expect(roleForDepth(2)).toBe('subagent');
	});
});

describe('sub-agent role policy', () => {
	it('embeds the same withheld-op set the app enforces', () => {
		expect(
			extractEmbeddedStringSet(readExtensionSource(), 'SUBAGENT_WITHHELD_OPS'),
		).toEqual([...SUBAGENT_WITHHELD_OPS].sort());
	});

	// A matching set that nothing reads would leave every tool registered, and the
	// only symptom would be a sub-agent meeting `denied-scope` on tools its
	// playbook never offered it. Both registration paths have to consult it: the
	// shared `tool()` helper, and `ensemblr_exit_plan_mode`, which registers on its
	// own because it aborts the turn after a successful call.
	it('gates both registration paths on that set', () => {
		const source = readExtensionSource();
		expect(source).toMatch(
			/return IS_CONCIERGE\s*\? !CONCIERGE_WITHHELD_OPS\.has\(op\)\s*: !IS_SUBAGENT \|\| !SUBAGENT_WITHHELD_OPS\.has\(op\);/,
		);
		expect(source).toMatch(/if \(!registersOp\(op\)\) \{\s*return;/);
		expect(source).toMatch(/if \(registersOp\('exitPlanMode'\)\) \{/);
	});

	// The two halves of the policy: a withheld op is either denied outright or
	// merely useless, never both and never neither. A denied op that fell out of
	// the map would still be missing from the tool list, and a stale caller — one
	// resumed after a restart — would find it working again.
	it('splits every withheld op into denied or unusable, never both', () => {
		for (const op of SUBAGENT_WITHHELD_OPS) {
			const denial = subAgentControlOpDenial(op);
			expect(
				denial === null,
				`\`${op}\` should be either denied or unusable`,
			).toBe(SUBAGENT_UNUSABLE_OPS.has(op));
		}
	});

	// A denial that redirects a child to a tool it also cannot reach sends it round
	// the same refusal — the failure the plan-mode reasons were written to avoid.
	it('never redirects a denied sub-agent to a tool it also lacks', () => {
		for (const op of SUBAGENT_WITHHELD_OPS) {
			const denial = subAgentControlOpDenial(op) ?? '';
			for (const [, named] of denial.matchAll(/`(ensemblr_[a-z_]+)`/g)) {
				expect(
					SUBAGENT_WITHHELD_OPS.has(controlOpForToolName(named)),
					`\`${op}\` redirects to \`${named}\`, which is also withheld`,
				).toBe(false);
			}
		}
	});

	// Naming a tool the app refuses as though it were available is what teaches a
	// model to keep reaching for it — the same reason the harness playbook omits
	// the Pi-only tools. Naming one in order to say it is refused is the opposite,
	// and both sub-agent playbooks do that deliberately, so the rule is per line:
	// wherever a withheld tool appears, that line has to be a refusal.
	it('names a withheld tool only to refuse it, in either sub-agent playbook', () => {
		const refusal = /refused|not yours|blocked|Do NOT|is not mine/;
		for (const op of SUBAGENT_WITHHELD_OPS) {
			const toolName = `ensemblr_${op.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`;
			for (const playbook of [
				SUBAGENT_AWARENESS,
				PLAN_MODE_SUBAGENT_AWARENESS,
			]) {
				for (const line of playbook.split('\n')) {
					if (!line.includes(toolName)) {
						continue;
					}
					expect(
						refusal.test(line),
						`\`${toolName}\` is named without a refusal: ${line.slice(0, 120)}`,
					).toBe(true);
				}
			}
		}
	});

	// The role gate is what makes the promise true. Before it, the playbook said
	// nested delegation was blocked while only the in-memory depth counter blocked
	// it, so a child resumed after a restart could delegate onward.
	it('backs the sub-agent playbook’s promises with a real denial', () => {
		expect(SUBAGENT_AWARENESS).toContain('nested delegation is blocked');
		expect(SUBAGENT_AWARENESS).toContain('refused here');
		for (const op of [
			'startConversation',
			'launchHarness',
			'writeTerminal',
			'setWorkspaceStatus',
			'askUserQuestion',
		] as const) {
			expect(subAgentControlOpDenial(op)).not.toBeNull();
		}
	});

	it('leaves a sub-agent the reads and the escalation hatch its playbook offers', () => {
		for (const op of [
			'listTabs',
			'listWorkspaces',
			'getWorkspaceStatus',
			'getLastMessage',
			'readTerminalOutput',
			'focusTab',
			'setName',
			'setSummary',
			'notifyOrchestrator',
		] as const) {
			expect(subAgentControlOpDenial(op)).toBeNull();
			expect(SUBAGENT_WITHHELD_OPS.has(op)).toBe(false);
		}
		expect(SUBAGENT_AWARENESS).toContain('ensemblr_notify_orchestrator');
	});
});

describe('Concierge role policy', () => {
	it('embeds the same withheld-op set the app enforces', () => {
		expect(
			extractEmbeddedStringSet(readExtensionSource(), 'CONCIERGE_WITHHELD_OPS'),
		).toEqual([...CONCIERGE_WITHHELD_OPS].sort());
	});

	// Every Concierge op is refused outright — there is no unusable half here, as
	// there is for a sub-agent — so a member with no reason would be withheld from
	// the tool list and then met with an empty denial by a stale caller.
	it('gives every withheld op a reason', () => {
		for (const op of CONCIERGE_WITHHELD_OPS) {
			expect(conciergeControlOpDenial(op), op).not.toBeNull();
		}
	});

	// The rule the sub-agent playbooks follow, for the same reason: naming a tool
	// the app refuses as though it were available is what teaches a model to keep
	// reaching for it, and naming one in order to say it is refused is the
	// opposite. The Concierge playbook does the latter for the chat-tab ops, which
	// is the whole point of the line — the app cannot refuse them on the chat-tab
	// axis, so the playbook has to say so.
	it('names a withheld tool only to refuse it', () => {
		const refusal = /refused|cannot|do not|Concierge only/;
		for (const op of CONCIERGE_WITHHELD_OPS) {
			const toolName = `ensemblr_${op.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`;
			for (const line of CONCIERGE_AWARENESS.split('\n')) {
				if (!line.includes(toolName)) {
					continue;
				}
				expect(
					refusal.test(line),
					`\`${toolName}\` is named without a refusal: ${line.slice(0, 120)}`,
				).toBe(true);
			}
		}
	});

	// The upkeep block asks for these two by name and the Concierge never receives
	// one, so the playbook is the only place it can learn they are not its job. It
	// said the opposite until the Concierge spent two calls a turn on them.
	it('tells the Concierge the tab bookkeeping is not its job', () => {
		expect(CONCIERGE_AWARENESS).toContain('ensemblr_set_name');
		expect(CONCIERGE_AWARENESS).toContain('ensemblr_set_summary');
		expect(CONCIERGE_AWARENESS).toContain('refused here');
	});

	// A model reads its playbook in order, and one told what it can read before it
	// is told what it is for treats reading as the task: it arrives at the spawn
	// having already spent the turn working out how, which is the orchestrator's
	// job and the reason the Concierge holds no write access in the first place.
	it('states the delegation directive ahead of the capability inventory', () => {
		const delegation = CONCIERGE_AWARENESS.indexOf(
			'## Your first move is to delegate',
		);
		const capabilities = CONCIERGE_AWARENESS.indexOf('## What you can do');
		expect(delegation).toBeGreaterThan(-1);
		expect(capabilities).toBeGreaterThan(delegation);
		expect(CONCIERGE_AWARENESS).toContain('ensemblr_create_workspace');
		expect(CONCIERGE_AWARENESS).toContain('ensemblr_send_follow_up');
	});

	// The one-writer rule is per worktree, and it read as a rule about the
	// Concierge until a task spanning two repositories — a release cut in one
	// while the other publishes its notes — was delegated one repository at a
	// time, leaving half the work idle for the length of the other half.
	it('caps orchestrators per workspace rather than per turn', () => {
		expect(CONCIERGE_AWARENESS).toContain('One orchestrator per workspace');
		expect(CONCIERGE_AWARENESS).not.toContain('one workspace at a time');
	});

	// Running the same task in several workspaces is the one fan-out that needs
	// the model id, and `listModels` is served to the Concierge for exactly that.
	// A playbook that never names it leaves every contender on the same model,
	// which is the variation the bake-off existed to buy.
	it('teaches the competing-implementation fan-out with a model id', () => {
		expect(CONCIERGE_AWARENESS).toContain('ensemblr_list_models');
		expect(CONCIERGE_WITHHELD_OPS.has('listModels')).toBe(false);
	});

	// The syntax is only useful if the playbook spells the exact destination the
	// renderer parses back, and says where the ids come from. A scheme typed
	// differently here renders as prose in every answer, silently.
	it('teaches the reference link syntax the renderer parses back', () => {
		for (const kind of ['chat', 'project', 'workspace'] as const) {
			const href = formatConciergeReferenceHref(kind, 'id');
			expect(CONCIERGE_AWARENESS).toContain(href.slice(0, href.length - 2));
		}
		expect(CONCIERGE_AWARENESS).toContain('ensemblr_list_workspaces');
		expect(CONCIERGE_AWARENESS).toContain('ensemblr_list_tabs');
	});
});

describe('harness playbook', () => {
	it('names no Pi-only tool, which the MCP endpoint never serves a harness', () => {
		for (const toolName of [
			'ensemblr_set_name',
			'ensemblr_set_summary',
			'ensemblr_ask_user_question',
			'ensemblr_exit_plan_mode',
		]) {
			expect(HARNESS_AWARENESS).not.toContain(toolName);
		}
	});

	it('tells a harness its tab is titled from its own session log', () => {
		expect(HARNESS_AWARENESS).toContain(
			'names itself from your own session log',
		);
	});

	it('teaches the same wait-based delegation loop as the orchestrator variant', () => {
		expect(HARNESS_AWARENESS).toContain('ensemblr_start_conversation');
		expect(HARNESS_AWARENESS).toContain('ensemblr_wait_for_agents');
		expect(HARNESS_AWARENESS).toContain('Do the work yourself by default');
	});

	// A harness receives no per-turn upkeep block — the app renders that into a Pi
	// system prompt and a harness has no equivalent hook — so unlike the Pi
	// playbooks this one has to carry the branch nudge itself. The tool still
	// honours `git.renameWorkspaceOnBranch`; the playbook's job is to frame a
	// refusal as settled rather than as a fault worth retrying.
	it('carries the branch nudge itself, since a harness gets no upkeep block', () => {
		expect(HARNESS_AWARENESS).toContain('ensemblr_set_branch_name');
		expect(HARNESS_AWARENESS).toContain(
			'settled outcome, not a fault to retry',
		);
		expect(HARNESS_AWARENESS).not.toContain(SESSION_BRIEF_NUDGE_HEADER);
	});

	it('stays lighter than the orchestrator variant it stands in for', () => {
		expect(HARNESS_AWARENESS.length).toBeLessThan(
			ORCHESTRATOR_AWARENESS.length,
		);
	});

	it('is absent from the Pi extension, which never serves a harness', () => {
		expect(readExtensionSource()).not.toContain('HARNESS_AWARENESS');
	});
});

// A tool description is the only instruction a model gets before its first call,
// and the two registration sites cannot import one another. Drift here shows up
// as one species behaving differently from the other, which is invisible until
// somebody compares transcripts.
describe('agent-control tool description parity', () => {
	it('registers every MCP tool in the Pi extension under the same op', () => {
		const embedded = extractEmbeddedToolDescriptions(readExtensionSource());
		for (const def of TOOL_DEFS) {
			expect(embedded.has(def.name)).toBe(true);
			expect(controlOpForToolName(def.name)).toBe(def.op);
		}
	});

	it('describes each shared tool identically in both surfaces', () => {
		const embedded = extractEmbeddedToolDescriptions(readExtensionSource());
		for (const def of TOOL_DEFS) {
			if (SPECIES_SPECIFIC_DESCRIPTIONS.has(def.name)) {
				continue;
			}
			expect(`${def.name}: ${embedded.get(def.name)}`).toBe(
				`${def.name}: ${def.description}`,
			);
		}
	});

	// An allowlisted tool is exempt because its two descriptions say genuinely
	// different things; one that has drifted back into agreement is an entry to
	// delete, not a passing case.
	it('keeps every species-specific description actually divergent', () => {
		const embedded = extractEmbeddedToolDescriptions(readExtensionSource());
		for (const name of SPECIES_SPECIFIC_DESCRIPTIONS) {
			const def = TOOL_DEFS.find((entry) => entry.name === name);
			expect(def).toBeDefined();
			expect(embedded.get(name)).not.toBe(def?.description);
		}
	});

	// The stat probe is the cheap read that stands between a model and a whole
	// workspace diff, so both surfaces have to lead with it in the imperative.
	it('leads the diff tool with the stat probe in both surfaces', () => {
		const diffTool = TOOL_DEFS.find(
			(def) => def.op === 'getWorkspaceDiff',
		)?.description;
		expect(diffTool).toContain('stat=true FIRST');
		expect(
			extractEmbeddedToolDescriptions(readExtensionSource()).get(
				'ensemblr_get_workspace_diff',
			),
		).toContain('stat=true FIRST');
	});
});

// The extension is outside every tsconfig and importable by nothing, so these
// source reads are the only guard there is. `askUserQuestion` holds its call
// open for as long as the user takes, and `fetch` — undici, five-minute
// `headersTimeout` — silently cut that short and lost the answer.
describe('control transport', () => {
	it('posts control ops over node:http, never fetch', () => {
		const source = readExtensionSource();
		expect(source).toContain("from 'node:http'");
		// Anchored on the call, not the word: the awareness prose lives here too,
		// and every call form counts, not just the awaited one.
		expect(source).not.toMatch(/\bfetch\s*\(/);
	});

	it('forwards Pi’s per-call cancellation signal into the control request', () => {
		const source = readExtensionSource();
		expect(source).toContain('function asAbortSignal(');
		expect(source).toMatch(/asAbortSignal\(signal\)/);
		expect(source).not.toMatch(/_signal: unknown/);
	});

	it('measures the request body in bytes, so wide characters survive it', () => {
		expect(readExtensionSource()).toContain('Buffer.byteLength(payload)');
	});
});

// The architecture diagram is a whole feature behind an Experimental switch, and
// off it is *absent* rather than refused: the two ops leave every tool list, so a
// playbook still describing them would send the model hunting for tools it does
// not hold. These assert the whole vocabulary goes, not just the bullet.
describe('the architecture diagram feature switch', () => {
	it('withholds both diagram ops from every role while it is off', () => {
		for (const role of ['orchestrator', 'subagent', 'concierge'] as const) {
			const withheld = withheldControlOps({
				architectureDiagram: false,
				tuiHarnesses: false,
				delegation: 'ensemblr',
				hasChatTab: true,
				role,
			});
			for (const op of ARCHITECTURE_DIAGRAM_OPS) {
				expect(withheld.has(op), `${role} should not hold \`${op}\``).toBe(
					true,
				);
			}
		}
	});

	it('leaves both diagram ops in place for a root while it is on', () => {
		const withheld = withheldControlOps({
			architectureDiagram: true,
			tuiHarnesses: true,
			delegation: 'ensemblr',
			hasChatTab: true,
			role: 'orchestrator',
		});
		for (const op of ARCHITECTURE_DIAGRAM_OPS) {
			expect(withheld.has(op)).toBe(false);
		}
	});

	it('names neither diagram tool in any playbook while it is off', () => {
		for (const playbook of AWARENESS_WITHOUT_DIAGRAM) {
			expect(playbook).not.toContain('ensemblr_get_architecture_diagram');
			expect(playbook).not.toContain('ensemblr_update_architecture_diagram');
		}
	});

	// The prose around the tool names goes too: a playbook that still discussed
	// "the architecture diagram" would have the model looking for a surface the
	// app does not draw and a skill it was never handed.
	it('mentions the diagram nowhere in any playbook while it is off', () => {
		for (const playbook of AWARENESS_WITHOUT_DIAGRAM) {
			expect(playbook.toLowerCase()).not.toContain('architecture diagram');
			expect(playbook).not.toContain('.ensemblr/architecture.json');
			expect(playbook).not.toContain('architecture-diagram');
		}
	});

	// Off must cut only the diagram: a slot that swallowed its neighbours would
	// pass every assertion above and quietly delete half a playbook.
	it('leaves every playbook otherwise intact', () => {
		const on = playbooksFor(ALL_ON);
		AWARENESS_WITHOUT_DIAGRAM.forEach((off, index) => {
			expect(off.length).toBeGreaterThan(on[index].length * 0.85);
			expect(off).not.toBe(on[index]);
		});
	});

	// The extension reads the switch off an env var the app sets, because neither
	// the MCP tool list nor the playbooks the app serves ever reach it.
	it('reads the switch from the env var the app writes', () => {
		const source = readExtensionSource();
		expect(source).toContain(
			`process.env.${CONTROL_ARCHITECTURE_ENV_KEY} === '${CONTROL_ARCHITECTURE_ENABLED}'`,
		);
		expect(
			extractEmbeddedStringSet(source, 'ARCHITECTURE_DIAGRAM_OPS'),
		).toEqual([...ARCHITECTURE_DIAGRAM_OPS].sort());
		expect(source).toMatch(
			/if \(!ARCHITECTURE_DIAGRAM_ON && ARCHITECTURE_DIAGRAM_OPS\.has\(op\)\) \{\s*return false;/,
		);
	});
});

describe('the third-party CLI harness feature switch', () => {
	it('withholds the launch op from every role while it is off', () => {
		for (const role of ['orchestrator', 'subagent', 'concierge'] as const) {
			const withheld = withheldControlOps({
				architectureDiagram: true,
				delegation: 'ensemblr',
				hasChatTab: true,
				role,
				tuiHarnesses: false,
			});
			for (const op of TUI_HARNESS_OPS) {
				expect(withheld.has(op), `${role} should not hold \`${op}\``).toBe(
					true,
				);
			}
		}
	});

	it('leaves the launch op in place for a root while it is on', () => {
		const withheld = withheldControlOps({
			architectureDiagram: true,
			delegation: 'ensemblr',
			hasChatTab: true,
			role: 'orchestrator',
			tuiHarnesses: true,
		});
		for (const op of TUI_HARNESS_OPS) {
			expect(withheld.has(op)).toBe(false);
		}
	});

	it('names the launch tool in no playbook while it is off', () => {
		for (const playbook of AWARENESS_WITHOUT_HARNESSES) {
			expect(playbook).not.toContain('ensemblr_launch_harness');
		}
		expect(
			conciergeAwareness({ ...ALL_ON, tuiHarnesses: false }),
		).not.toContain('ensemblr_launch_harness');
	});

	// The prose around the tool name goes too. A playbook that still said a
	// harness terminal can hold a co-tenancy slot, or that a sub-agent may not
	// launch one, would describe a thing the app can no longer produce.
	//
	// The harness variant is exempt and stays in the op assertion above: it is
	// served only to a caller that is itself a harness, so telling one what it is
	// describes something that demonstrably exists. Everything an agent with a
	// chat tab reads must be silent on the subject.
	it('mentions a harness nowhere a non-harness would read it while off', () => {
		const [orchestrator, native, subagent, , planOrchestrator, planSubagent] =
			AWARENESS_WITHOUT_HARNESSES;
		const playbooks = [
			orchestrator,
			native,
			subagent,
			planOrchestrator,
			planSubagent,
			conciergeAwareness({ ...ALL_ON, tuiHarnesses: false }),
		];
		for (const playbook of playbooks) {
			const lowered = playbook.toLowerCase();
			expect(lowered).not.toContain('harness');
			expect(lowered).not.toContain('claude code');
			expect(lowered).not.toContain('codex');
		}
	});

	// Off must cut only the harness clauses: a guard that swallowed its
	// neighbours would pass every assertion above and delete half a playbook.
	it('leaves every playbook otherwise intact', () => {
		const on = playbooksFor(ALL_ON);
		AWARENESS_WITHOUT_HARNESSES.forEach((off, index) => {
			expect(off.length).toBeGreaterThan(on[index].length * 0.85);
			expect(off).not.toBe(on[index]);
		});
	});

	// The extension reads the switch off an env var the app sets, because neither
	// the MCP tool list nor the playbooks the app serves ever reach it.
	it('reads the switch from the env var the app writes', () => {
		const source = readExtensionSource();
		expect(source).toContain(
			`process.env.${CONTROL_TUI_HARNESSES_ENV_KEY} === '${CONTROL_TUI_HARNESSES_ENABLED}'`,
		);
		expect(extractEmbeddedStringSet(source, 'TUI_HARNESS_OPS')).toEqual(
			[...TUI_HARNESS_OPS].sort(),
		);
		expect(source).toMatch(
			/if \(!TUI_HARNESSES_ON && TUI_HARNESS_OPS\.has\(op\)\) \{\s*return false;/,
		);
	});
});
