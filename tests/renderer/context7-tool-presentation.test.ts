import { describe, expect, test } from 'vitest';
import { presentToolCall } from '../../src/renderer/lib/agent-timeline/tool-presentation';
import { glyphForToolName } from '../../src/renderer/lib/agent-timeline/tool-presenters';
import { dynamicToolCall as call } from './support/tool-presentation';

const CONTEXT7_TOOLS = [
	'context7_get_cached_doc_raw',
	'context7_get_library_docs',
	'context7_resolve_library_id',
] as const;

describe('Context7 tool presentation', () => {
	test.each(CONTEXT7_TOOLS)('%s has a dedicated presenter', (name) => {
		const presentation = presentToolCall(call(name, {}, { text: '' }));

		expect(presentation.title).not.toBe(name);
		expect(glyphForToolName(name)).toBe('scroll-text');
	});

	test('presents library resolution by the requested package name', () => {
		const presentation = presentToolCall(
			call(
				'context7_resolve_library_id',
				{ libraryName: 'react', query: 'concurrent rendering' },
				{
					details: { libraryId: '/facebook/react' },
					text: '/facebook/react — React\nThe library for web and native user interfaces.',
				},
			),
		);

		expect(presentation).toMatchObject({
			body: { kind: 'markdown' },
			glyph: 'scroll-text',
			preview: { font: 'mono', text: 'react · /facebook/react' },
			title: 'Resolve Context7 library',
		});
	});

	test('presents fresh documentation without repeating the input object', () => {
		const presentation = presentToolCall(
			call(
				'context7_get_library_docs',
				{
					libraryId: '/facebook/react',
					query: 'How does useTransition work?',
					tokens: 3000,
				},
				{
					details: { bytes: 1200, cached: false, libraryId: '/facebook/react' },
					text: '# useTransition\n\n`useTransition` lets you render in the background.',
				},
			),
		);

		expect(presentation).toMatchObject({
			body: { kind: 'markdown' },
			glyph: 'scroll-text',
			preview: {
				font: 'sans',
				text: '/facebook/react · How does useTransition work?',
			},
			title: 'Fetch Context7 docs',
		});
	});

	test('marks documentation served from the session cache', () => {
		const presentation = presentToolCall(
			call(
				'context7_get_library_docs',
				{ libraryId: '/facebook/react', query: 'hooks' },
				{
					details: { cached: true, libraryId: '/facebook/react' },
					text: '# React hooks',
				},
			),
		);

		expect(presentation.preview).toEqual({
			font: 'sans',
			text: '/facebook/react · hooks · cache hit',
		});
	});

	test('identifies cache hits in the collapsed preview', () => {
		const presentation = presentToolCall(
			call(
				'context7_get_cached_doc_raw',
				{ libraryId: '/facebook/react' },
				{
					details: { libraryId: '/facebook/react', match: 'prefix' },
					text: '# React docs',
				},
			),
		);

		expect(presentation).toMatchObject({
			body: { kind: 'markdown' },
			glyph: 'scroll-text',
			preview: { font: 'sans', text: '/facebook/react · cache hit' },
			title: 'Read cached Context7 docs',
		});
	});

	test('surfaces Context7 failures returned in details', () => {
		const presentation = presentToolCall(
			call(
				'context7_get_library_docs',
				{ libraryId: '/facebook/react', query: 'hooks' },
				{
					details: { error: 'Docs fetch failed: 429 Too Many Requests' },
					text: 'Error fetching docs: Docs fetch failed: 429 Too Many Requests',
				},
			),
		);

		expect(presentation).toMatchObject({
			body: {
				kind: 'error',
				text: 'Error fetching docs: Docs fetch failed: 429 Too Many Requests',
			},
			tone: 'destructive',
		});
	});
});
