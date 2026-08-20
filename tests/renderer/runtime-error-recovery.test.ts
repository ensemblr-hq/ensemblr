/**
 * "Send again" has to re-send the user's own prompt, not the scaffolding the
 * composer wrapped around it — a persisted prompt carries the inlined body of
 * every file that was attached, and resubmitting those verbatim would send a
 * snapshot of a file that has since changed.
 */

import type { UIMessage } from 'ai';
import { describe, expect, test } from 'vitest';

import { retryPromptsByMessageId } from '../../src/renderer/hooks/workbench-shell/timeline/use-runtime-error-recovery';

function message(id: string, role: UIMessage['role'], text: string): UIMessage {
	return { id, parts: [{ state: 'done', text, type: 'text' }], role };
}

describe('retryPromptsByMessageId', () => {
	test('offers the prompt that opened the failed turn', () => {
		const prompts = retryPromptsByMessageId([
			message('m1', 'user', 'Rename the column'),
			message('m2', 'assistant', 'Working on it'),
			message('m3', 'system', 'Boom'),
		]);

		expect(prompts.get('m3')).toBe('Rename the column');
	});

	test('offers the nearest earlier prompt, not the newest in the transcript', () => {
		const prompts = retryPromptsByMessageId([
			message('m1', 'user', 'First ask'),
			message('m2', 'system', 'Boom'),
			message('m3', 'user', 'Second ask'),
			message('m4', 'system', 'Boom again'),
		]);

		expect(prompts.get('m2')).toBe('First ask');
		expect(prompts.get('m4')).toBe('Second ask');
	});

	test('drops an attached file’s inlined body and keeps what was typed', () => {
		const prompts = retryPromptsByMessageId([
			message(
				'm1',
				'user',
				'Fix this\n\n<attached_file path="src/a.ts">\nconst a = 1;\n</attached_file>',
			),
			message('m2', 'system', 'Boom'),
		]);

		expect(prompts.get('m2')).toBe('Fix this');
	});

	test('offers nothing when no prompt precedes the failure', () => {
		const prompts = retryPromptsByMessageId([message('m1', 'system', 'Boom')]);

		expect(prompts.get('m1')).toBeUndefined();
	});
});
