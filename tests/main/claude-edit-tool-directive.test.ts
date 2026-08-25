import { describe, expect, it } from 'vitest';

import { resolveSystemPromptAppend } from '../../src/main/claude-agent/claude-edit-tool-directive.ts';

const PLAYBOOK = 'You are running inside Ensemblr.';

describe('Claude system prompt append: the file-tool override', () => {
	it('overrides the CLI Bash-first instruction in every unprompted mode', () => {
		for (const permissionMode of [
			'auto',
			'bypassPermissions',
			'dontAsk',
		] as const) {
			const append = resolveSystemPromptAppend({ permissionMode });

			expect(append).toContain('Edit and Write to change one');
			expect(append).toContain('reverses the preference stated elsewhere');
		}
	});

	it('spends nothing on a mode the CLI never steers toward Bash', () => {
		for (const permissionMode of ['acceptEdits', 'default', 'plan'] as const) {
			expect(
				resolveSystemPromptAppend({
					permissionMode,
					systemPromptAppend: PLAYBOOK,
				}),
			).toBe(PLAYBOOK);
		}
	});

	it('returns null when a gated mode carries no append of its own', () => {
		expect(resolveSystemPromptAppend({ permissionMode: 'default' })).toBeNull();
		expect(
			resolveSystemPromptAppend({
				permissionMode: 'plan',
				systemPromptAppend: '   ',
			}),
		).toBeNull();
	});

	it("keeps the app's own playbook first, so the override reads as the later word", () => {
		const append = resolveSystemPromptAppend({
			permissionMode: 'bypassPermissions',
			systemPromptAppend: PLAYBOOK,
		});

		expect(append?.startsWith(`${PLAYBOOK}\n\n`)).toBe(true);
		expect(append).toContain('Read to read a file');
	});

	it('states the reason, so the preference is not an arbitrary rule', () => {
		const append =
			resolveSystemPromptAppend({ permissionMode: 'bypassPermissions' }) ?? '';

		expect(append).toContain('timeline');
		expect(append).toContain('diff');
	});

	it('leaves the shell available rather than forbidding it', () => {
		const append =
			resolveSystemPromptAppend({ permissionMode: 'bypassPermissions' }) ?? '';

		expect(append).toContain('Bash remains the right tool');
		expect(append).not.toMatch(/\bnever (use|with|rewrite|reach)\b/i);
		for (const use of ['tests', 'git', '`grep`', 'mechanical sweep']) {
			expect(append).toContain(use);
		}
	});
});
