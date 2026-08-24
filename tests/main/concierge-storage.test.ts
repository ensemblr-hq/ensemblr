import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { ensureConciergeHome } from '../../src/main/concierge/concierge-home.ts';
import { createConciergeMemoryService } from '../../src/main/concierge/concierge-memory-service.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import {
	deleteConciergeMemory,
	getConciergeMemoryBySlug,
	listConciergeMemories,
	rebuildConciergeMemoryIndex,
	searchConciergeMemories,
	upsertConciergeMemory,
} from '../../src/main/storage/repositories/concierge-memory-repository.ts';
import {
	appendConciergeEvent,
	createConciergeSession,
	getActiveConciergeSession,
	listConciergeEvents,
	listConciergeSessions,
	updateConciergeSession,
} from '../../src/main/storage/repositories/concierge-session-repository.ts';

function openDatabase(t: import('node:test').TestContext): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-concierge-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'concierge-test.db'),
	});
	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});
	return connection.database;
}

function openMemoryService(t: import('node:test').TestContext) {
	const database = openDatabase(t);
	const directory = mkdtempSync(
		path.join(tmpdir(), 'ensemblr-concierge-home-'),
	);
	t.after(() => rmSync(directory, { force: true, recursive: true }));
	const home = ensureConciergeHome(path.join(directory, 'concierge'));
	const service = createConciergeMemoryService({
		requireDatabase: () => database,
		resolveHome: () => home,
	});
	const write = (slug: string, body: string) =>
		writeFileSync(path.join(home.memoryPath, `${slug}.md`), body, 'utf8');

	return { database, home, service, write };
}

function seedMemory(
	database: DatabaseSync,
	overrides: { body?: string; slug: string; summary?: string; title?: string },
) {
	return upsertConciergeMemory({
		database,
		input: {
			body: overrides.body ?? 'body text',
			contentHash: `hash-${overrides.slug}`,
			fileMtimeMs: 1,
			kind: 'project',
			relativePath: `memory/${overrides.slug}.md`,
			slug: overrides.slug,
			summary: overrides.summary ?? 'summary text',
			title: overrides.title ?? overrides.slug,
		},
	});
}

test('opens a Concierge session with no workspace of any kind', (t) => {
	const database = openDatabase(t);

	const session = createConciergeSession({
		database,
		input: { cwd: '/tmp/ensemblr/concierge', provider: 'pi' },
	});

	assert.equal(session.cwd, '/tmp/ensemblr/concierge');
	assert.equal(session.provider, 'pi');
	assert.equal(session.status, 'idle');
	assert.equal(session.closedAt, null);
	assert.equal(session.nextOrdinal, 0);

	const workspaceColumns = database
		.prepare('PRAGMA table_info(concierge_sessions)')
		.all()
		.map((row) => (row as { name: string }).name);
	assert.equal(workspaceColumns.includes('workspace_id'), false);
});

test('resumes the newest open session and skips closed ones', (t) => {
	const database = openDatabase(t);

	const first = createConciergeSession({
		database,
		input: { cwd: '/tmp/a', provider: 'pi' },
	});
	updateConciergeSession({
		database,
		id: first.id,
		patch: { closedAt: '2026-08-24T00:00:00.000Z', status: 'closed' },
	});
	const second = createConciergeSession({
		database,
		input: { cwd: '/tmp/b', provider: 'claude' },
	});

	assert.equal(getActiveConciergeSession({ database })?.id, second.id);
	assert.equal(listConciergeSessions({ database }).length, 1);
	assert.equal(
		listConciergeSessions({ database, includeClosed: true }).length,
		2,
	);
});

test('appends transcript events with contiguous ordinals', (t) => {
	const database = openDatabase(t);
	const session = createConciergeSession({
		database,
		input: { cwd: '/tmp/c', provider: 'pi' },
	});

	for (const text of ['one', 'two', 'three']) {
		appendConciergeEvent({
			database,
			input: {
				eventType: 'message',
				payload: {
					kind: 'message',
					payload: { kind: 'text', text },
					role: 'agent',
				},
				sessionId: session.id,
			},
		});
	}

	const events = listConciergeEvents({ database, sessionId: session.id });
	assert.deepEqual(
		events.map((event) => event.ordinal),
		[0, 1, 2],
	);
	assert.equal(
		listConciergeEvents({ database, fromOrdinal: 2, sessionId: session.id })
			.length,
		1,
	);
});

test('cascades transcript events when a session row is deleted', (t) => {
	const database = openDatabase(t);
	const session = createConciergeSession({
		database,
		input: { cwd: '/tmp/d', provider: 'pi' },
	});
	appendConciergeEvent({
		database,
		input: { eventType: 'status', sessionId: session.id },
	});

	database.exec('PRAGMA foreign_keys = ON');
	database
		.prepare('DELETE FROM concierge_sessions WHERE id = ?')
		.run(session.id);

	assert.equal(
		listConciergeEvents({ database, sessionId: session.id }).length,
		0,
	);
});

test('indexes a memory and finds it by full-text search', (t) => {
	const database = openDatabase(t);

	seedMemory(database, {
		body: 'The bruckner workspace migrated storage to node:sqlite.',
		slug: 'bruckner-storage',
		summary: 'Storage migration notes',
		title: 'Bruckner storage',
	});
	seedMemory(database, {
		body: 'Unrelated content about scheduling.',
		slug: 'other',
		summary: 'Something else',
		title: 'Other',
	});

	const hits = searchConciergeMemories({ database, query: 'bruckner storage' });
	assert.equal(hits.at(0)?.slug, 'bruckner-storage');
	assert.equal(hits.at(0)?.relativePath, 'memory/bruckner-storage.md');
});

test('replaces a memory in place rather than duplicating its slug', (t) => {
	const database = openDatabase(t);

	seedMemory(database, { slug: 'pinned', title: 'First' });
	seedMemory(database, { slug: 'pinned', title: 'Second' });

	assert.equal(listConciergeMemories({ database }).length, 1);
	assert.equal(
		getConciergeMemoryBySlug({ database, slug: 'pinned' })?.title,
		'Second',
	);
	assert.equal(
		searchConciergeMemories({ database, query: 'First' }).length,
		0,
		'the stale FTS row must be gone, not merely shadowed',
	);
});

test('drops a memory from the table and the index together', (t) => {
	const database = openDatabase(t);
	seedMemory(database, { slug: 'temporary', title: 'Temporary' });

	assert.equal(deleteConciergeMemory({ database, slug: 'temporary' }), true);
	assert.equal(listConciergeMemories({ database }).length, 0);
	assert.equal(
		searchConciergeMemories({ database, query: 'Temporary' }).length,
		0,
	);
	assert.equal(deleteConciergeMemory({ database, slug: 'temporary' }), false);
});

test('treats FTS5 operators in a query as ordinary terms', (t) => {
	const database = openDatabase(t);
	seedMemory(database, {
		body: 'A note that mentions nothing special.',
		slug: 'plain',
		title: 'Plain',
	});

	assert.doesNotThrow(() =>
		searchConciergeMemories({ database, query: 'NOT repo:* AND "' }),
	);
	assert.deepEqual(searchConciergeMemories({ database, query: '   ' }), []);
});

test('rebuilds the index from the memory rows', (t) => {
	const database = openDatabase(t);
	seedMemory(database, { slug: 'rebuilt', title: 'Rebuilt' });

	database.exec('DELETE FROM concierge_memories_fts');
	assert.equal(
		searchConciergeMemories({ database, query: 'Rebuilt' }).length,
		0,
	);

	rebuildConciergeMemoryIndex({ database });
	assert.equal(
		searchConciergeMemories({ database, query: 'Rebuilt' }).length,
		1,
	);
});

test('reconciliation indexes the memory files on disk', (t) => {
	const { database, service, write } = openMemoryService(t);
	write(
		'a-fact',
		'---\nkind: project\ndescription: A fact\n---\n\n# A fact\n\nbody',
	);
	write('another', '# Another\n\nbody');

	assert.deepEqual(service.reconcile(), { indexed: 2, removed: 0 });
	assert.deepEqual(
		listConciergeMemories({ database })
			.map((row) => row.slug)
			.sort(),
		['a-fact', 'another'],
	);
});

test('reconciliation leaves an unchanged file’s row alone', (t) => {
	const { database, service, write } = openMemoryService(t);
	write('a-fact', '# A fact\n\nbody');
	service.reconcile();
	const first = getConciergeMemoryBySlug({ database, slug: 'a-fact' });

	assert.deepEqual(service.reconcile(), { indexed: 1, removed: 0 });

	// The content hash is what decides, so an untouched file keeps the row it
	// already had rather than paying a transaction per reconcile.
	assert.equal(
		getConciergeMemoryBySlug({ database, slug: 'a-fact' })?.updatedAt,
		first?.updatedAt,
	);
});

test('reconciliation re-indexes a file whose contents changed', (t) => {
	const { database, service, write } = openMemoryService(t);
	write('a-fact', '# A fact\n\nfirst');
	service.reconcile();
	write('a-fact', '# A fact\n\nsecond');

	service.reconcile();

	assert.equal(
		getConciergeMemoryBySlug({ database, slug: 'a-fact' })?.body,
		'# A fact\n\nsecond',
	);
});

test('reconciliation drops the row behind a deleted file', (t) => {
	const { home, service, write } = openMemoryService(t);
	write('a-fact', '# A fact\n\nbody');
	service.reconcile();
	rmSync(path.join(home.memoryPath, 'a-fact.md'));

	assert.deepEqual(service.reconcile(), { indexed: 0, removed: 1 });
});

// An unreadable directory is not an empty one: reading the throw as "no files"
// deleted every indexed row and reported the wipe as a successful reconcile.
test('reconciliation keeps the index when the directory cannot be read', (t) => {
	const { database, home, service, write } = openMemoryService(t);
	write('a-fact', '# A fact\n\nbody');
	service.reconcile();
	rmSync(home.memoryPath, { force: true, recursive: true });

	assert.deepEqual(service.reconcile(), { indexed: 0, removed: 0 });
	assert.equal(listConciergeMemories({ database }).length, 1);
});
