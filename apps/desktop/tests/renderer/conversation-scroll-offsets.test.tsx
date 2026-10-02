// @vitest-environment happy-dom

/**
 * The remembered-offset map is capped, so a long session cannot grow it without
 * end. These tests drive the accessor hook directly to pin the eviction rule
 * (the newest write always survives) and the `forget` path a closed tab needs.
 */

import { renderHook } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { beforeEach, describe, expect, test } from 'vitest';

import {
	type ConversationScrollOffsets,
	conversationScrollOffsetsAtom,
	useConversationScrollOffsets,
} from '../../src/renderer/state/conversation-scroll';

const MAX_REMEMBERED_CONVERSATIONS = 100;

/** Mounts the accessor hook and hands back its imperative surface. */
function renderOffsets(): ConversationScrollOffsets {
	return renderHook(() => useConversationScrollOffsets()).result.current;
}

/** A distinct offset per tab, so an assertion can tell them apart. */
function offsetFor(index: number) {
	return { scrollTop: index, stuckToBottom: false };
}

/** The whole remembered map, straight off the atom. */
function rememberedKeys(): string[] {
	return Object.keys(getDefaultStore().get(conversationScrollOffsetsAtom));
}

beforeEach(() => {
	getDefaultStore().set(conversationScrollOffsetsAtom, {});
});

describe('useConversationScrollOffsets', () => {
	test('reads back what it remembered', () => {
		const offsets = renderOffsets();

		offsets.remember('tab-a', { scrollTop: 120, stuckToBottom: false });

		expect(offsets.read('tab-a')).toEqual({
			scrollTop: 120,
			stuckToBottom: false,
		});
		expect(offsets.read('tab-b')).toBeNull();
	});

	test('caps the map and keeps the newest conversation when it overflows', () => {
		const offsets = renderOffsets();

		for (let index = 0; index <= MAX_REMEMBERED_CONVERSATIONS; index += 1) {
			offsets.remember(`tab-${index}`, offsetFor(index));
		}

		expect(rememberedKeys()).toHaveLength(MAX_REMEMBERED_CONVERSATIONS);
		expect(offsets.read(`tab-${MAX_REMEMBERED_CONVERSATIONS}`)).toEqual(
			offsetFor(MAX_REMEMBERED_CONVERSATIONS),
		);
		expect(offsets.read('tab-0')).toBeNull();
		expect(offsets.read('tab-1')).toEqual(offsetFor(1));
	});

	test('forgets one conversation and leaves the rest alone', () => {
		const offsets = renderOffsets();
		offsets.remember('tab-a', offsetFor(1));
		offsets.remember('tab-b', offsetFor(2));

		offsets.forget('tab-a');

		expect(offsets.read('tab-a')).toBeNull();
		expect(offsets.read('tab-b')).toEqual(offsetFor(2));
		expect(rememberedKeys()).toEqual(['tab-b']);
	});

	test('forgetting an unknown conversation is a no-op', () => {
		const offsets = renderOffsets();
		offsets.remember('tab-a', offsetFor(1));

		offsets.forget('tab-missing');

		expect(rememberedKeys()).toEqual(['tab-a']);
	});

	test('never mutates the map it replaces', () => {
		const offsets = renderOffsets();
		offsets.remember('tab-a', offsetFor(1));
		const before = getDefaultStore().get(conversationScrollOffsetsAtom);

		offsets.remember('tab-b', offsetFor(2));
		offsets.forget('tab-a');

		expect(before).toEqual({ 'tab-a': offsetFor(1) });
	});
});
