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
});
