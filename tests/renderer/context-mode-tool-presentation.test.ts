import { describe, expect, test } from 'vitest';

import { presentToolCall } from '../../src/renderer/lib/agent-timeline/tool-presentation';
import { dynamicToolCall as call } from './support/tool-presentation';

describe('context-mode tool presentation', () => {
	test('presents execution without repeating escaped input', () => {
		const code = "console.log('focused result')";
		const presentation = presentToolCall(
			call(
				'ctx_execute',
				{
					code,
					intent: 'failing renderer tests',
					language: 'javascript',
					timeout: 120_000,
				},
				{
					text: `\`\`\`javascript\n${code}\n\`\`\`\n\nExit code: 1\n\nstdout:\nfocused result`,
				},
			),
		);

		expect(presentation).toMatchObject({
			badge: null,
			body: {
				kind: 'labeled',
				sections: [
					{ label: 'Code:', muted: true, text: code },
					{
						label: 'Output:',
						muted: false,
						text: 'Exit code: 1\n\nstdout:\nfocused result',
					},
				],
			},
			glyph: 'square-terminal',
			preview: { font: 'sans', text: 'failing renderer tests' },
			title: 'Run code',
		});
	});

	test.each([
		{ path: undefined, toolName: 'ctx_execute' },
		{ path: 'package.json', toolName: 'ctx_execute_file' },
	] as const)(
		'preserves embedded fences in $toolName source',
		({ path, toolName }) => {
			const code = [
				'const markdown = `before',
				'```',
				'',
				'after`;',
				'console.log(markdown);',
			].join('\n');
			const pathPrefix = path === undefined ? '' : `path=${path}\n`;
			const presentation = presentToolCall(
				call(
					toolName,
					{
						code,
						language: 'javascript',
						...(path === undefined ? {} : { path }),
					},
					{
						text: `${pathPrefix}\`\`\`javascript\n${code}\n\`\`\`\n\nfinished`,
					},
				),
			);

			expect(presentation.body).toMatchObject({
				sections: [{ text: code }, { label: 'Output:', text: 'finished' }],
			});
		},
	);

	test('presents file processing with a pinned target', () => {
		const code = 'console.log(FILE_CONTENT.length)';
		const presentation = presentToolCall(
			call(
				'ctx_execute_file',
				{
					code,
					intent: 'configuration size',
					language: 'javascript',
					path: 'package.json',
				},
				{
					text: `path=package.json\n\`\`\`javascript\n${code}\n\`\`\`\n\n15240`,
				},
			),
		);

		expect(presentation).toMatchObject({
			badge: { kind: 'file', path: 'package.json' },
			body: {
				kind: 'labeled',
				sections: [
					{ label: 'Code:', muted: true, text: code },
					{ label: 'Output:', muted: false, text: '15240' },
				],
			},
			glyph: 'square-terminal',
			preview: { font: 'sans', text: 'configuration size' },
			title: 'Process file',
		});
	});
});
