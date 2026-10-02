import { expect, test } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr/query-keys';
import { invalidateWorkspaceGitStatus } from '../../src/renderer/api/ensemblr/workspace-git';
import {
	serializeWorkspaceGitDiffScope,
	type WorkspaceGitDiffScope,
} from '../../src/shared/ipc/contracts/workspace-git';
import { createTestQueryClient } from './support/dom';

const WORKSPACE_CWD = '/repo/feature';
const FROM = 'a'.repeat(40);
const TO = 'b'.repeat(40);

/** The status query key a scope is cached under. */
function keyFor(scope: WorkspaceGitDiffScope) {
	return ensemblrQueryKeys.workspaceGitStatus(
		WORKSPACE_CWD,
		serializeWorkspaceGitDiffScope(scope),
	);
}

test('a file change refreshes live scopes and leaves immutable ones cached', async () => {
	const client = createTestQueryClient();
	const scopes: readonly WorkspaceGitDiffScope[] = [
		{ kind: 'working-tree' },
		{ baseRef: 'main', kind: 'branch' },
		{ fromRef: FROM, kind: 'turn' },
		{ fromRef: FROM, kind: 'turn', toRef: TO },
		{ commitHash: TO, kind: 'commit' },
	];
	for (const scope of scopes) {
		client.setQueryData(keyFor(scope), { files: [] });
	}

	await invalidateWorkspaceGitStatus(client, WORKSPACE_CWD);

	const invalidated = scopes.map(
		(scope) => client.getQueryState(keyFor(scope))?.isInvalidated,
	);
	expect(invalidated).toEqual([true, true, true, false, false]);
});
