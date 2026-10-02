/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import { isPreviewTab } from '../../src/main/chat-tabs/preview-tab-slot.ts';
import type { ChatTabRow } from '../../src/main/storage/repositories/chat-tab-repository.ts';
import {
	type ChatTabServiceFixture,
	openChatTabServiceFixture,
} from './helpers/chat-tab-service-fixture.ts';

/**
 * Opens a file tab for `filePath`, ephemeral unless the caller pins it.
 * @param fixture - The service fixture under test
 * @param filePath - Workspace-relative path the tab previews
 * @param preview - False to open a permanent tab
 * @returns The opened tab row
 */
function openFileTab(
	fixture: ChatTabServiceFixture,
	filePath: string,
	preview = true,
): ChatTabRow {
	return fixture.service.openTab({
		kind: 'file',
		metadata: { filePath },
		preview,
		title: filePath,
		workspaceId: fixture.workspaceId,
	});
}

/**
 * Ids of the workspace's open tabs, in strip order.
 * @param fixture - The service fixture under test
 * @returns The open tab ids
 */
function openTabIds(fixture: ChatTabServiceFixture): string[] {
	return fixture.service
		.listTabs({ workspaceId: fixture.workspaceId })
		.open.map((tab) => tab.id);
}

test('a preview open retargets the preview tab instead of adding one', (t) => {
	const fixture = openChatTabServiceFixture(t);
	const chat = fixture.service.openTab({ workspaceId: fixture.workspaceId });

	const first = openFileTab(fixture, 'src/a.ts');
	const second = openFileTab(fixture, 'src/b.ts');

	assert.equal(second.id, first.id);
	assert.equal(second.position, first.position);
	assert.equal(second.title, 'src/b.ts');
	assert.equal(second.metadata.filePath, 'src/b.ts');
	assert.deepEqual(openTabIds(fixture), [chat.id, first.id]);
});

test('a retargeted preview tab takes the new subject kind', (t) => {
	const fixture = openChatTabServiceFixture(t);
	fixture.service.openTab({ workspaceId: fixture.workspaceId });

	const file = openFileTab(fixture, 'src/a.ts');
	const diff = fixture.service.openTab({
		kind: 'diff',
		metadata: { filePath: 'src/b.ts' },
		preview: true,
		title: 'b.ts',
		workspaceId: fixture.workspaceId,
	});

	assert.equal(diff.id, file.id);
	assert.equal(diff.kind, 'diff');
});

test('re-opening the previewed subject re-focuses without changing the tab', (t) => {
	const fixture = openChatTabServiceFixture(t);
	fixture.service.openTab({ workspaceId: fixture.workspaceId });

	const first = openFileTab(fixture, 'src/a.ts');
	const again = openFileTab(fixture, 'src/a.ts');

	assert.equal(again.id, first.id);
	assert.equal(again.metadata.preview, true);
	assert.equal(openTabIds(fixture).length, 2);
});

test('pinTab frees the slot so the next preview opens its own tab', (t) => {
	const fixture = openChatTabServiceFixture(t);
	fixture.service.openTab({ workspaceId: fixture.workspaceId });

	const pinnedSource = openFileTab(fixture, 'src/a.ts');
	const pinned = fixture.service.pinTab({ chatTabId: pinnedSource.id });
	const next = openFileTab(fixture, 'src/b.ts');

	assert.equal(pinned?.metadata.preview, undefined);
	assert.notEqual(next.id, pinnedSource.id);
	assert.equal(openTabIds(fixture).length, 3);
});

test('pinTab is a no-op for permanent and unknown tabs', (t) => {
	const fixture = openChatTabServiceFixture(t);
	const permanent = openFileTab(fixture, 'src/a.ts', false);

	assert.equal(
		fixture.service.pinTab({ chatTabId: permanent.id })?.id,
		permanent.id,
	);
	assert.equal(fixture.service.pinTab({ chatTabId: 'missing-tab' }), null);
});

test('a permanent open of the previewed subject pins that tab', (t) => {
	const fixture = openChatTabServiceFixture(t);
	fixture.service.openTab({ workspaceId: fixture.workspaceId });

	const previewed = openFileTab(fixture, 'src/a.ts');
	const promoted = openFileTab(fixture, 'src/a.ts', false);
	const next = openFileTab(fixture, 'src/b.ts');

	assert.equal(promoted.id, previewed.id);
	assert.equal(promoted.metadata.preview, undefined);
	assert.notEqual(next.id, previewed.id);
});

test('a permanent open never lands in the preview slot', (t) => {
	const fixture = openChatTabServiceFixture(t);
	fixture.service.openTab({ workspaceId: fixture.workspaceId });

	const previewed = openFileTab(fixture, 'src/a.ts');
	const permanent = openFileTab(fixture, 'src/b.ts', false);

	assert.notEqual(permanent.id, previewed.id);
	assert.equal(permanent.metadata.preview, undefined);
	assert.equal(openTabIds(fixture).length, 3);
});

test('chat and terminal tabs ignore the preview flag', (t) => {
	const fixture = openChatTabServiceFixture(t);

	const chat = fixture.service.openTab({
		preview: true,
		workspaceId: fixture.workspaceId,
	});
	const terminal = fixture.service.openTab({
		kind: 'terminal',
		metadata: { harnessId: 'claude', terminalId: 'pty-1' },
		preview: true,
		title: 'Claude',
		workspaceId: fixture.workspaceId,
	});
	const file = openFileTab(fixture, 'src/a.ts');

	assert.equal(chat.metadata.preview, undefined);
	assert.equal(terminal.metadata.preview, undefined);
	assert.equal(file.metadata.preview, true);
	assert.deepEqual(openTabIds(fixture), [chat.id, terminal.id, file.id]);
});

test('comment previews share one slot and re-focus on the same comment', (t) => {
	const fixture = openChatTabServiceFixture(t);
	fixture.service.openTab({ workspaceId: fixture.workspaceId });

	const openComment = (id: string): ChatTabRow =>
		fixture.service.openTab({
			kind: 'document',
			metadata: { commentPreview: { detail: id, id, provider: 'github' } },
			preview: true,
			title: `Comment ${id}`,
			workspaceId: fixture.workspaceId,
		});

	const first = openComment('comment-1');
	const second = openComment('comment-2');
	const again = openComment('comment-2');

	assert.equal(second.id, first.id);
	assert.equal(again.id, second.id);
	assert.equal(openTabIds(fixture).length, 2);
});

test('isPreviewTab is what the wire mapping reads, not a metadata literal', (t) => {
	const fixture = openChatTabServiceFixture(t);

	const previewed = openFileTab(fixture, 'src/a.ts');
	const permanent = openFileTab(fixture, 'src/b.ts', false);

	const pinned = fixture.service.pinTab({ chatTabId: previewed.id });

	assert.equal(isPreviewTab(previewed), true);
	assert.equal(isPreviewTab(permanent), false);
	assert.ok(pinned);
	assert.equal(isPreviewTab(pinned), false);
});

test('closing a preview tab lets the next preview open a fresh one', (t) => {
	const fixture = openChatTabServiceFixture(t);
	const chat = fixture.service.openTab({ workspaceId: fixture.workspaceId });

	const previewed = openFileTab(fixture, 'src/a.ts');
	assert.deepEqual(fixture.service.closeTab({ chatTabId: previewed.id }), {
		deleted: true,
	});
	const next = openFileTab(fixture, 'src/b.ts');

	assert.notEqual(next.id, previewed.id);
	assert.deepEqual(openTabIds(fixture), [chat.id, next.id]);
});
