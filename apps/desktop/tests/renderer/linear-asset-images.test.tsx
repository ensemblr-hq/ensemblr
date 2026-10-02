// @vitest-environment happy-dom

/**
 * The join between the two halves of the Linear image fix: main strips the
 * expiring signature and the renderer re-points the image at the authenticated
 * proxy scheme, but none of that reaches Linear unless the `<img>` survives the
 * markdown pipeline. Streamdown sanitizes `<img src>` down to http and https, so
 * without the widened schema the proxy scheme is replaced by a blocked-image
 * badge and the main-process handler is never called at all.
 */

import { createStore, Provider } from 'jotai';
import { expect, test } from 'vitest';

import { ChatMessageText } from '../../src/renderer/components/chat-message-text';
import {
	LINEAR_ASSET_SCHEME,
	proxyLinearAssetImages,
} from '../../src/shared/linear-assets';
import { renderWithProviders } from './support/dom';

const ACCOUNT_ID = '1ef5f628-0386-40d3-8ab1-fded1e0989bb';
const ASSET_PATH = '/workspace-a/issue-b/asset-c';

/** Renders markdown through the shipped answer renderer inside a fresh store. */
function renderMarkdown(text: string) {
	const { container } = renderWithProviders(
		<Provider store={createStore()}>
			<ChatMessageText text={text} />
		</Provider>,
	);
	return container;
}

test('a proxied Linear image reaches the DOM as an img on the asset scheme', () => {
	const container = renderMarkdown(
		proxyLinearAssetImages(
			`![shot](https://uploads.linear.app${ASSET_PATH})`,
			ACCOUNT_ID,
		),
	);

	expect(
		container.querySelector('[data-streamdown="image"]')?.getAttribute('src'),
	).toBe(`${LINEAR_ASSET_SCHEME}://${ACCOUNT_ID}${ASSET_PATH}`);
});

test('widening the schema admits only the asset scheme', () => {
	for (const source of [
		'javascript:alert(1)',
		'data:image/png;base64,iVBORw0KGgo=',
		'vbscript:msgbox(1)',
	]) {
		const container = renderMarkdown(`![x](${source})`);

		expect(container.querySelector('[data-streamdown="image"]')).toBe(null);
	}
});

test('an ordinary https image still renders', () => {
	const container = renderMarkdown('![x](https://example.com/a.png)');

	expect(
		container.querySelector('[data-streamdown="image"]')?.getAttribute('src'),
	).toBe('https://example.com/a.png');
});
