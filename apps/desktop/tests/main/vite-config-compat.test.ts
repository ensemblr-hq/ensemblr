import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ViteConfigGenerator from '@electron-forge/plugin-vite/dist/ViteConfig.js';
import {
	build,
	createLogger,
	loadConfigFromFile,
	resolveConfig,
	type UserConfig,
} from 'vite';
import { describe, expect, test, vi } from 'vitest';

import preloadConfig from '../../vite.preload.config.mts';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const viteConfigs = [
	'vite.main.config.mts',
	'vite.preload.config.mts',
	'vite.renderer.config.mts',
];

describe('Vite config compatibility', () => {
	test('migrates the preload output through the instrumented config plugin', async () => {
		const resolved = await resolveConfig(
			{
				...preloadConfig,
				configFile: false,
				build: {
					rollupOptions: {
						output: { format: 'cjs', inlineDynamicImports: true },
					},
				},
			},
			'build',
		);

		expect(resolved.build.rolldownOptions.output).toEqual({
			format: 'cjs',
			codeSplitting: false,
		});
	});

	test.each([
		{ name: 'absent output', output: undefined },
		{
			name: 'array output',
			output: [{ format: 'cjs', inlineDynamicImports: true }],
		},
		{ name: 'modern output', output: { format: 'cjs', codeSplitting: true } },
	] satisfies {
		name: string;
		output: NonNullable<
			NonNullable<UserConfig['build']>['rolldownOptions']
		>['output'];
	}[])('leaves $name unchanged', async ({ output }) => {
		const expected = structuredClone(output);
		const resolved = await resolveConfig(
			{
				...preloadConfig,
				configFile: false,
				build: { rolldownOptions: { output } },
			},
			'build',
		);

		expect(resolved.build.rolldownOptions.output).toEqual(expected);
	});

	test.each(['bundle', 'native'] as const)(
		'loads through the %s config loader without compatibility warnings',
		async (configLoader) => {
			const warnings: string[] = [];
			const logger = createLogger('silent');
			logger.warn = (message) => warnings.push(message);

			for (const configFile of viteConfigs) {
				const loaded = await loadConfigFromFile(
					{ command: 'build', mode: 'production' },
					path.join(repositoryRoot, configFile),
					repositoryRoot,
					'warn',
					logger,
					configLoader,
				);
				expect(loaded?.path).toBe(path.join(repositoryRoot, configFile));
			}

			expect(warnings).toEqual([]);
		},
	);

	test('keeps the Forge preload build single-file without deprecated output options', async () => {
		const generator = new ViteConfigGenerator(
			{
				build: [
					{
						config: path.join(repositoryRoot, 'vite.preload.config.mts'),
						entry: path.join(repositoryRoot, 'src/preload/preload.ts'),
						target: 'preload',
					},
				],
				renderer: [],
			},
			repositoryRoot,
			true,
		);
		const [forgeConfig] = await generator.getBuildConfigs();
		const resolved = await resolveConfig(
			{ ...forgeConfig, configFile: false },
			'build',
		);
		const output = resolved.build.rolldownOptions.output;
		if (!output || Array.isArray(output)) {
			throw new Error('Forge preload build must have one output configuration');
		}

		const stderr: string[] = [];
		const stderrWrite = vi
			.spyOn(process.stderr, 'write')
			.mockImplementation((chunk) => {
				stderr.push(String(chunk));
				return true;
			});
		let built: Awaited<ReturnType<typeof build>>;
		try {
			built = await build({
				...forgeConfig,
				build: { ...forgeConfig.build, write: false },
				configFile: false,
			});
		} finally {
			stderrWrite.mockRestore();
		}

		expect(stderr.join('')).not.toContain('inlineDynamicImports');
		expect(output).not.toHaveProperty('inlineDynamicImports');
		expect(output.codeSplitting).toBe(false);
		if (Array.isArray(built) || !('output' in built)) {
			throw new Error('Expected an in-memory preload build result');
		}
		expect(built.output.filter(({ type }) => type === 'chunk')).toHaveLength(1);
	});
});
