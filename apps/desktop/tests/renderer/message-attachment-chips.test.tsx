import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { ChatMessageText } from '../../src/renderer/components/chat-message-text';

describe('chat message attachment chips', () => {
	test('renders inline code file references as attachment chips', () => {
		const markup = renderToStaticMarkup(
			<ChatMessageText
				text={
					'Read files:\n\n- `README.md`\n- `src/app/page.tsx`\n\nThen run `npm run check`.'
				}
			/>,
		);

		expect(markup).toContain('title="README.md"');
		expect(markup).toContain('title="src/app/page.tsx"');
		expect(markup).toContain('page.tsx');
		expect(markup).not.toContain('<code>README.md</code>');
		expect(markup).toContain('<code>npm run check</code>');
	});

	test('leaves library display names as ordinary inline code', () => {
		const markup = renderToStaticMarkup(
			<ChatMessageText text={'Built on `Node.js` and `Vue.js`.'} />,
		);

		expect(markup).toContain('<code>Node.js</code>');
		expect(markup).toContain('<code>Vue.js</code>');
		expect(markup).not.toContain('title="Node.js"');
	});

	test('renders an absolute path outside the workspace as a chip', () => {
		const markup = renderToStaticMarkup(
			<ChatMessageText
				text={'Wrote `/tmp/scratch.md` and `~/.claude/plans/plan.md`.'}
			/>,
		);

		expect(markup).toContain('title="/tmp/scratch.md"');
		expect(markup).toContain('title="~/.claude/plans/plan.md"');
		expect(markup).not.toContain('<code>/tmp/scratch.md</code>');
	});

	// A real root can hold a space — `~/Library/Application Support/…`, or the
	// Ensemblr dev root — and a chip is the only thing that says the span is a
	// file rather than the sentence running on.
	test('renders a rooted path containing spaces as a chip', () => {
		const markup = renderToStaticMarkup(
			<ChatMessageText
				text={'Read `/Users/dev/Ensemblr (DEV)/repos/app/README.md`.'}
			/>,
		);

		expect(markup).toContain(
			'title="/Users/dev/Ensemblr (DEV)/repos/app/README.md"',
		);
	});

	test('leaves a spaced span that is not rooted as ordinary inline code', () => {
		const markup = renderToStaticMarkup(
			<ChatMessageText text={'Run `npm run check` and `bun add left-pad`.'} />,
		);

		expect(markup).toContain('<code>npm run check</code>');
		expect(markup).toContain('<code>bun add left-pad</code>');
	});

	test('leaves an absolute path with no file extension as prose', () => {
		const markup = renderToStaticMarkup(
			<ChatMessageText text={'Resolved via `/usr/bin/env` on PATH.'} />,
		);

		expect(markup).toContain('<code>/usr/bin/env</code>');
		expect(markup).not.toContain('title="/usr/bin/env"');
	});
});
