import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ContextIndicator } from '../../src/renderer/components/workbench-shell/conversation-panel/composer/context-indicator';

test('leaves the context ring empty when no tokens are used', () => {
	const markup = renderToStaticMarkup(
		<ContextIndicator usage={{ maxTokens: 258_400, usedTokens: 0 }} />,
	);

	expect(markup).not.toContain('stroke-dasharray');
});

test('renders context ring progress when tokens are used', () => {
	const markup = renderToStaticMarkup(
		<ContextIndicator usage={{ maxTokens: 100, usedTokens: 25 }} />,
	);

	expect(markup).toContain('stroke-dasharray="25, 100"');
});

test('leaves the context ring empty when usage is unknown', () => {
	const markup = renderToStaticMarkup(<ContextIndicator usage={null} />);

	expect(markup).not.toContain('stroke-dasharray');
	expect(markup).toContain('Context usage gauge');
});
