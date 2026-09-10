import { describe, expect, it } from 'vitest';

import {
	getWorkspaceFileIconName,
	getWorkspaceFileIconNameForPath,
} from '@/renderer/lib/workbench/file-icons';

describe('workspace dotenv icons', () => {
	it.each([
		'.env',
		'.env.local',
		'.env.production',
		'.env.production.local',
		'.env.example',
	])('uses the dotenv icon for %s, including nested paths', (name) => {
		expect(getWorkspaceFileIconName({ kind: 'file', name })).toBe(
			'vscode-icons:file-type-dotenv',
		);
		expect(getWorkspaceFileIconNameForPath(`config/${name}`)).toBe(
			'vscode-icons:file-type-dotenv',
		);
	});

	it.each(['.environment', '.envrc', '.envfile'])(
		'keeps the default file icon for %s',
		(name) => {
			expect(getWorkspaceFileIconName({ kind: 'file', name })).toBe(
				'vscode-icons:default-file',
			);
		},
	);

	it.each(['.env', '.env.local'])(
		'preserves folder and symlink precedence for %s',
		(name) => {
			expect(getWorkspaceFileIconName({ kind: 'directory', name })).toBe(
				'vscode-icons:default-folder',
			);
			expect(
				getWorkspaceFileIconName(
					{ kind: 'directory', name },
					{ isExpanded: true },
				),
			).toBe('vscode-icons:default-folder-opened');
			for (const symlinkTargetKind of [
				'file',
				'directory',
				'unknown',
			] as const) {
				expect(
					getWorkspaceFileIconName({ kind: 'file', name, symlinkTargetKind }),
				).toBe(
					symlinkTargetKind === 'directory'
						? 'ensemblr:folder-symlink'
						: 'ensemblr:file-symlink',
				);
			}
		},
	);
});
