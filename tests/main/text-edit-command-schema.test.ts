import { expect, test } from 'vitest';

import {
	addWordToDictionaryRequestSchema,
	replaceMisspellingRequestSchema,
	textEditCommandSchema,
} from '../../src/main/ipc/request-schemas/text-editing';
import { TEXT_EDIT_COMMANDS } from '../../src/shared/text-edit-commands';

test('every shared command is accepted', () => {
	for (const command of TEXT_EDIT_COMMANDS) {
		expect(textEditCommandSchema.parse(command)).toBe(command);
	}
});

test('a command outside the table is rejected', () => {
	// The handler indexes into `event.sender` with whatever survives this schema,
	// so anything it lets through is a WebContents method the renderer can call.
	for (const command of [
		'close',
		'reload',
		'executeJavaScript',
		'__proto__',
		'constructor',
		'',
		42,
		null,
		undefined,
		{ command: 'paste' },
	]) {
		expect(textEditCommandSchema.safeParse(command).success).toBe(false);
	}
});

test('a correction is accepted and a blank or oversized one is not', () => {
	expect(
		replaceMisspellingRequestSchema.parse({ replacement: 'receive' }),
	).toEqual({ replacement: 'receive' });

	for (const replacement of ['', 'x'.repeat(257), null, undefined, 42, {}]) {
		expect(
			replaceMisspellingRequestSchema.safeParse({ replacement }).success,
		).toBe(false);
	}

	expect(replaceMisspellingRequestSchema.safeParse('receive').success).toBe(
		false,
	);
});

test('a dictionary word is accepted and a blank or oversized one is not', () => {
	expect(addWordToDictionaryRequestSchema.parse({ word: 'ensemblr' })).toEqual({
		word: 'ensemblr',
	});

	for (const word of ['', 'x'.repeat(257), null, undefined, 42, {}]) {
		expect(addWordToDictionaryRequestSchema.safeParse({ word }).success).toBe(
			false,
		);
	}
});
