import { describe, expect, it } from 'vitest';

import { readWorkspaceLinkedIssue } from '../../src/main/agent-control/index.ts';
import type { EnsemblrDatabaseService } from '../../src/main/storage';

const WORKSPACE_ID = 'ws-1';

/**
 * A database whose one workspace row carries the metadata JSON under test, so the
 * assertions read the same untyped blob the renderer actually persists. The row
 * key is the query's `metadataJson` alias rather than the column name.
 * @param metadataJson - The workspace's metadata JSON, or null for no row.
 * @returns A database service stub exposing that row.
 */
const databaseWith = (metadataJson: string | null): EnsemblrDatabaseService =>
	({
		getConnection: () => ({
			database: {
				prepare: () => ({
					get: (id: string) =>
						id === WORKSPACE_ID && metadataJson !== null
							? { metadataJson }
							: undefined,
				}),
			},
		}),
	}) as unknown as EnsemblrDatabaseService;

const read = (metadataJson: string | null) =>
	readWorkspaceLinkedIssue({
		databaseService: databaseWith(metadataJson),
		workspaceId: WORKSPACE_ID,
	});

describe('readWorkspaceLinkedIssue', () => {
	it('reads the issue a Linear-created workspace recorded', () => {
		expect(
			read(
				JSON.stringify({
					linkedIssue: {
						accountId: 'acct-1',
						identifier: 'ENG-106',
						provider: 'linear',
						title: 'Expose Linear to agents',
						url: 'https://linear.app/the/issue/ENG-106',
					},
				}),
			),
		).toEqual({
			accountId: 'acct-1',
			identifier: 'ENG-106',
			provider: 'linear',
			title: 'Expose Linear to agents',
			url: 'https://linear.app/the/issue/ENG-106',
		});
	});

	// The landing summary writes the human key as `reference` while a search result
	// writes it as `identifier`, and a workspace can have been created either way.
	it('accepts the human key under either field the renderer writes it as', () => {
		expect(
			read(
				JSON.stringify({
					linkedIssue: { provider: 'linear', reference: 'ENG-9', title: 'x' },
				}),
			)?.identifier,
		).toBe('ENG-9');
	});

	// A workspace created before ADR 0052 recorded no account at all, and the
	// identifier is still the load-bearing half.
	it('keeps an issue that recorded no account', () => {
		expect(
			read(
				JSON.stringify({
					linkedIssue: { identifier: 'ENG-1', provider: 'linear', title: 't' },
				}),
			),
		).toMatchObject({ accountId: null, identifier: 'ENG-1' });
	});

	it('falls back to the identifier when no title was recorded', () => {
		expect(
			read(
				JSON.stringify({
					linkedIssue: { identifier: 'ENG-2', provider: 'linear' },
				}),
			)?.title,
		).toBe('ENG-2');
	});

	it('reads a GitHub-linked workspace as GitHub rather than dropping it', () => {
		expect(
			read(
				JSON.stringify({
					linkedIssue: { identifier: '#42', provider: 'github', title: 'bug' },
				}),
			)?.provider,
		).toBe('github');
	});

	it('reports nothing for a workspace with no linked issue', () => {
		expect(read(JSON.stringify({ someOtherKey: true }))).toBeNull();
	});

	it('reports nothing when the workspace row is absent', () => {
		expect(read(null)).toBeNull();
	});

	// The column is untyped JSON the renderer wrote, so a blob missing the fields
	// that identify an issue has to read as no issue rather than as a half one.
	it('reports nothing for a blob with no identifier', () => {
		expect(
			read(JSON.stringify({ linkedIssue: { provider: 'linear', title: 't' } })),
		).toBeNull();
	});

	it('reports nothing for a provider it does not know', () => {
		expect(
			read(
				JSON.stringify({
					linkedIssue: { identifier: 'X-1', provider: 'jira', title: 't' },
				}),
			),
		).toBeNull();
	});

	it('reports nothing when the database is closed', () => {
		expect(
			readWorkspaceLinkedIssue({
				databaseService: {
					getConnection: () => null,
				} as unknown as EnsemblrDatabaseService,
				workspaceId: WORKSPACE_ID,
			}),
		).toBeNull();
	});
});
