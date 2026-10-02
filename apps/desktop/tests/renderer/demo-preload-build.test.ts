import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { expect, test } from 'vitest';

test('builds a self-contained preload for Electron’s sandbox', async () => {
	const outDir = mkdtempSync(path.join(tmpdir(), 'ensemblr-demo-preload-'));
	try {
		await build({
			configFile: path.resolve('vite.demo-main.config.mts'),
			mode: 'preload',
			logLevel: 'silent',
			build: { outDir, emptyOutDir: true },
		});
		const exposed: string[] = [];
		runInNewContext(
			readFileSync(path.join(outDir, 'demo-preload.js'), 'utf8'),
			{
				process: { platform: 'darwin' },
				require: (specifier: string) => {
					expect(specifier).toBe('electron');
					return {
						contextBridge: {
							exposeInMainWorld: (name: string) => exposed.push(name),
						},
						ipcRenderer: { invoke: () => Promise.resolve() },
					};
				},
			},
		);
		expect(exposed).toEqual(['ensemblrInitialShellSnapshot', 'ensemblrDemo']);
	} finally {
		rmSync(outDir, { recursive: true, force: true });
	}
});
