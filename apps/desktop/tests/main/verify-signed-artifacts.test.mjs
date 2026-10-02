import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

const { lipoCalls } = vi.hoisted(() => ({ lipoCalls: [] }));

vi.mock('node:child_process', () => ({
	spawnSync: (_command, args) => {
		const path = args.at(-1) ?? '';
		lipoCalls.push(path);
		if (path.includes('unreadable.node')) {
			return { status: 1, stderr: 'not Mach-O', stdout: '' };
		}
		return {
			status: 0,
			stderr: '',
			stdout: path.includes('wrong.node') ? 'arm64' : 'x86_64',
		};
	},
}));

const { verifyBundleArch } = await import(
	'../../scripts/verify-signed-artifacts.mjs'
);

const roots = [];

function appBundle({ executable = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'ensemblr-signed-'));
	roots.push(root);
	const app = join(root, 'Ensemblr.app');
	mkdirSync(join(app, 'Contents'), { recursive: true });
	if (executable) {
		mkdirSync(join(app, 'Contents', 'MacOS'));
		writeFileSync(join(app, 'Contents', 'MacOS', 'Ensemblr'), 'executable');
	}
	return app;
}

function binding(app, relativePath) {
	const path = join(
		app,
		'Contents',
		'Resources',
		'app.asar.unpacked',
		relativePath,
	);
	mkdirSync(join(path, '..'), { recursive: true });
	writeFileSync(path, 'binding');
	return path;
}

afterEach(() => {
	lipoCalls.length = 0;
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe('signed artifact native-binding verification', () => {
	test('checks active bindings but ignores unloadable copies', () => {
		const app = appBundle();
		const active = binding(app, 'node_modules/node-pty/build/Release/pty.node');
		const stale = binding(
			app,
			'node_modules/node-pty/bin/darwin-arm64-149/node-pty.node',
		);
		const foreignPrebuild = binding(
			app,
			'node_modules/node-pty/prebuilds/darwin-arm64/pty.node',
		);

		expect(verifyBundleArch(app, 'x64')).toEqual([]);
		expect(lipoCalls).toContain(active);
		expect(lipoCalls).not.toContain(stale);
		expect(lipoCalls).not.toContain(foreignPrebuild);
	});

	test('rejects a bundle without an executable', () => {
		const app = appBundle({ executable: false });

		expect(verifyBundleArch(app, 'x64')).toEqual([
			`${app} holds no executable.`,
		]);
		expect(lipoCalls).toEqual([]);
	});

	test('rejects a bundle without an active native binding', () => {
		const app = appBundle();

		expect(verifyBundleArch(app, 'x64')).toEqual([
			`${app} carries no loadable native binding; node-pty should be packaged, so the terminal would not work in this build.`,
		]);
		expect(lipoCalls).toEqual([]);
	});

	test('reports a binding that lipo cannot read', () => {
		const app = appBundle();
		const unreadable = binding(
			app,
			'node_modules/node-pty/build/Release/unreadable.node',
		);

		expect(verifyBundleArch(app, 'x64')).toEqual([
			`lipo could not read ${unreadable}:\nnot Mach-O`,
		]);
	});

	test('rejects a wrong architecture in an active binding location', () => {
		const app = appBundle();
		const wrong = binding(
			app,
			'node_modules/node-pty/build/Release/wrong.node',
		);

		expect(verifyBundleArch(app, 'x64')).toEqual([
			`${wrong} holds [arm64], expected x86_64 (--arch=x64).`,
		]);
	});
});
