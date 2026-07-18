import assert from 'node:assert/strict';
import test from 'node:test';

import { detectDesktopRuntime } from '../../src/main/workspace-runtime/detect-desktop-runtime.ts';

test('returns null for a plain web project', () => {
	const runtime = detectDesktopRuntime({
		packageJson: { dependencies: { react: '^19.0.0' }, name: 'web-app' },
		runCommand: 'vite dev',
		tauriConf: null,
	});

	assert.equal(runtime, null);
});

test('detects Electron from a dependency and resolves the build product name', () => {
	const runtime = detectDesktopRuntime({
		packageJson: {
			build: { productName: 'Acme Studio' },
			devDependencies: { electron: '^33.0.0' },
			name: 'acme',
		},
		runCommand: 'electron .',
		tauriConf: null,
	});

	assert.deepEqual(runtime, { appName: 'Acme Studio', framework: 'electron' });
});

test('detects Electron from the run command when deps are absent', () => {
	const runtime = detectDesktopRuntime({
		packageJson: { name: 'globally-installed' },
		runCommand: 'electron-forge start',
		tauriConf: null,
	});

	assert.deepEqual(runtime, {
		appName: 'globally-installed',
		framework: 'electron',
	});
});

test('detects Tauri and prefers its config product name', () => {
	const runtime = detectDesktopRuntime({
		packageJson: {
			devDependencies: { '@tauri-apps/cli': '^2.0.0' },
			name: 'pkg-name',
		},
		runCommand: 'tauri dev',
		tauriConf: { productName: 'Tauri App' },
	});

	assert.deepEqual(runtime, { appName: 'Tauri App', framework: 'tauri' });
});

test('reads the v1 Tauri product name from the package block', () => {
	const runtime = detectDesktopRuntime({
		packageJson: { dependencies: { '@tauri-apps/api': '^1.0.0' }, name: 'x' },
		runCommand: null,
		tauriConf: { package: { productName: 'Legacy Tauri' } },
	});

	assert.deepEqual(runtime, { appName: 'Legacy Tauri', framework: 'tauri' });
});

test('prefers Tauri over Electron when both signals are present', () => {
	const runtime = detectDesktopRuntime({
		packageJson: {
			devDependencies: { '@tauri-apps/cli': '^2.0.0', electron: '^33.0.0' },
			name: 'hybrid',
		},
		runCommand: null,
		tauriConf: null,
	});

	assert.equal(runtime?.framework, 'tauri');
});

test('falls back to a null app name when nothing names the app', () => {
	const runtime = detectDesktopRuntime({
		packageJson: { dependencies: { electron: '^33.0.0' } },
		runCommand: null,
		tauriConf: null,
	});

	assert.deepEqual(runtime, { appName: null, framework: 'electron' });
});

test('tolerates malformed manifest inputs', () => {
	assert.equal(
		detectDesktopRuntime({
			packageJson: null,
			runCommand: null,
			tauriConf: null,
		}),
		null,
	);
	assert.equal(
		detectDesktopRuntime({
			packageJson: 'not-an-object',
			runCommand: '',
			tauriConf: [],
		}),
		null,
	);
});
