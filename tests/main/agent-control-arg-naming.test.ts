import { describe, expect, it } from 'vitest';

import { TOOL_DEFS } from '../../src/main/agent-control/index.ts';
import {
	AGENT_CONTROL_ARG_ALIASES,
	AGENT_CONTROL_OPS,
	type AgentControlOp,
	argKeysForOp,
	CANONICAL_ARG_KEYS,
	canonicalizeArgs,
	validateArgs,
} from '../../src/shared/agent-control.ts';
import {
	controlOpForToolName,
	extractEmbeddedToolParamKeys,
	readExtensionSource,
} from './support/pi-extension-source.ts';

const ops = [...AGENT_CONTROL_OPS];

// One concept spelled two ways reaches the model as two words for one thing, and
// it guesses — which is how `ensemblr_set_name` got called with the `title` that
// `ensemblr_start_conversation` takes. The vocabulary is the fix; this is what
// stops the next op from coining a synonym for something already named.
describe('agent-control argument vocabulary', () => {
	it.each(ops)('spells every %s argument with a canonical key', (op) => {
		for (const key of argKeysForOp(op)) {
			expect(
				Object.hasOwn(CANONICAL_ARG_KEYS, key),
				`\`${key}\` is not in CANONICAL_ARG_KEYS. Reuse the key that already carries this concept, or add a row for a genuinely new one.`,
			).toBe(true);
		}
	});

	it('documents every canonical key it declares', () => {
		for (const [key, meaning] of Object.entries(CANONICAL_ARG_KEYS)) {
			expect(
				meaning.length,
				`\`${key}\` has no meaning recorded`,
			).toBeGreaterThan(0);
		}
	});

	it('labels every tab, plan, and summary with `title`, never `name`', () => {
		for (const op of [
			'spawnChatTab',
			'startConversation',
			'setName',
		] as const) {
			expect(argKeysForOp(op)).toContain('title');
			expect(argKeysForOp(op)).not.toContain('name');
		}
	});

	it('names every workspace-relative path `filePath`', () => {
		for (const op of [
			'getWorkspaceDiff',
			'getDiffComments',
			'openTab',
		] as const) {
			expect(argKeysForOp(op)).toContain('filePath');
			expect(argKeysForOp(op)).not.toContain('file');
		}
	});
});

// An alias pointing at a key that has since been renamed would rewrite a working
// call into a validation error, which is worse than never having forgiven it.
describe('agent-control argument aliases', () => {
	it('resolves every alias to a key its own op accepts', () => {
		for (const [op, aliases] of Object.entries(AGENT_CONTROL_ARG_ALIASES)) {
			const accepted = argKeysForOp(op as AgentControlOp);
			for (const [alias, canonical] of Object.entries(aliases)) {
				expect(accepted, `${op}.${alias} → ${canonical}`).toContain(canonical);
				expect(accepted, `${op} accepts \`${alias}\` outright`).not.toContain(
					alias,
				);
			}
		}
	});

	it('rewrites a near-miss key to the canonical one', () => {
		expect(canonicalizeArgs('setName', { name: 'Composer audit' })).toEqual({
			title: 'Composer audit',
		});
		expect(
			canonicalizeArgs('getWorkspaceDiff', { file: 'src/main/main.ts' }),
		).toEqual({ filePath: 'src/main/main.ts' });
	});

	it('keeps the canonical value when both spellings arrive', () => {
		expect(
			canonicalizeArgs('setName', { name: 'guess', title: 'chosen' }),
		).toEqual({ title: 'chosen' });
	});

	it('leaves untouched an op with no aliases and a payload that is not an object', () => {
		expect(canonicalizeArgs('closeTab', { chatTabId: 'tab-1' })).toEqual({
			chatTabId: 'tab-1',
		});
		expect(canonicalizeArgs('setName', 'not-an-object')).toBe('not-an-object');
	});

	it('accepts the confused key end to end at the validation boundary', () => {
		expect(validateArgs('setName', { name: 'Composer audit' })).toEqual({
			ok: true,
			value: { title: 'Composer audit' },
		});
		expect(
			validateArgs('startConversation', { name: 'Scout', prompt: 'go' }),
		).toEqual({ ok: true, value: { title: 'Scout', prompt: 'go' } });
		expect(
			validateArgs('setBranchName', { slug: 'add-dark-mode' }),
		).toMatchObject({ ok: true, value: { name: 'add-dark-mode' } });
	});

	// A model cannot read the schema, so "unrecognized key" alone leaves it
	// guessing a second word where naming the vocabulary settles the retry.
	it('names the accepted keys when a key it does not know arrives', () => {
		const result = validateArgs('setName', { label: 'Composer audit' });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain('This op accepts: title.');
		}
	});
});

// The three surfaces cannot import one another, so a key renamed in the Zod
// schemas and left alone in either registration site turns every call from that
// species into a validation error nobody sees until a transcript is compared.
describe('agent-control argument key parity', () => {
	it('declares the same MCP tool shape as the schema accepts', () => {
		for (const def of TOOL_DEFS) {
			expect(Object.keys(def.shape).sort(), def.name).toEqual([
				...argKeysForOp(def.op),
			]);
		}
	});

	// Both surfaces now register the whole vocabulary and cut it to the caller at
	// serve time, so a tool present in one and missing from the other is a gap
	// rather than a deliberate omission.
	it('registers the same tool vocabulary in both surfaces', () => {
		const embedded = extractEmbeddedToolParamKeys(readExtensionSource());
		expect([...embedded.keys()].sort()).toEqual(
			TOOL_DEFS.map((def) => def.name).sort(),
		);
	});

	it('declares the same Pi extension parameters as the schema accepts', () => {
		const embedded = extractEmbeddedToolParamKeys(readExtensionSource());
		expect(embedded.size).toBeGreaterThan(0);
		for (const [toolName, keys] of embedded) {
			const op = controlOpForToolName(toolName);
			expect([...keys].sort(), toolName).toEqual([...argKeysForOp(op)]);
		}
	});
});
