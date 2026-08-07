import { describe, expect, test } from 'vitest';

import {
	canSetTitle,
	readTitleProvenance,
} from '../../src/main/agent-runtime/naming/title-provenance';

describe('readTitleProvenance', () => {
	test('reads each producer back', () => {
		expect(readTitleProvenance({ titleProvenance: 'auto' })).toBe('auto');
		expect(readTitleProvenance({ titleProvenance: 'agent' })).toBe('agent');
		expect(readTitleProvenance({ titleProvenance: 'user' })).toBe('user');
	});

	test('reports null for a tab written before the field existed', () => {
		expect(readTitleProvenance({})).toBeNull();
	});

	test('reports null for a value outside the ladder', () => {
		expect(readTitleProvenance({ titleProvenance: 'robot' })).toBeNull();
		expect(readTitleProvenance({ titleProvenance: 7 })).toBeNull();
	});
});

describe('canSetTitle', () => {
	test('lets any producer claim an unowned title', () => {
		expect(canSetTitle(null, 'auto')).toBe(true);
		expect(canSetTitle(null, 'agent')).toBe(true);
		expect(canSetTitle(null, 'user')).toBe(true);
	});

	test('lets the agent overwrite a derived title', () => {
		expect(canSetTitle('auto', 'agent')).toBe(true);
	});

	test('never lets the agent overwrite a title the user chose', () => {
		expect(canSetTitle('user', 'agent')).toBe(false);
		expect(canSetTitle('user', 'auto')).toBe(false);
	});

	test('never lets a derived title overwrite one the agent chose', () => {
		expect(canSetTitle('agent', 'auto')).toBe(false);
	});

	test('lets a producer refine its own title', () => {
		expect(canSetTitle('auto', 'auto')).toBe(true);
		expect(canSetTitle('agent', 'agent')).toBe(true);
		expect(canSetTitle('user', 'user')).toBe(true);
	});

	test('lets the user take a title from anyone', () => {
		expect(canSetTitle('auto', 'user')).toBe(true);
		expect(canSetTitle('agent', 'user')).toBe(true);
	});
});
