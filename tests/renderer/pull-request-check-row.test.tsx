import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import { PullRequestCheckRow } from '../../src/renderer/components/workbench-shell/checks-panel/pr-rows';
import type { PullRequestCheckSummary } from '../../src/renderer/types/workbench';

function renderCheck(check: PullRequestCheckSummary) {
	return renderToStaticMarkup(<PullRequestCheckRow check={check} />);
}

test('pending checks show a warning spinner and provider mark', () => {
	const markup = renderCheck({
		id: 'vercel-build',
		label: 'Vercel',
		provider: 'vercel',
		status: 'pending',
		url: 'https://github.com/ensemblr/ensemblr/runs/1',
	});

	expect(markup).toContain('data-check-status="pending"');
	expect(markup).toContain('aria-label="Running"');
	expect(markup).toContain('text-status-warning');
	expect(markup).toContain('motion-safe:animate-spin');
	expect(markup).toContain('lucide-loader-circle');
	expect(markup).toContain('aria-label="Vercel"');
	expect(markup).toContain('lucide-triangle');
	expect(markup).toContain('target="_blank"');
});

test('passed checks show a green check and elapsed time', () => {
	const markup = renderCheck({
		durationLabel: '33s',
		id: 'code-review',
		label: 'Code review',
		provider: 'github',
		status: 'ready',
	});

	expect(markup).toContain('data-check-status="ready"');
	expect(markup).toContain('aria-label="Passed"');
	expect(markup).toContain('text-status-ok');
	expect(markup).toContain('lucide-check');
	expect(markup).toContain('33s');
});

test('failed checks show a red X', () => {
	const markup = renderCheck({
		id: 'tests',
		label: 'Tests',
		provider: 'github',
		status: 'blocked',
	});

	expect(markup).toContain('data-check-status="blocked"');
	expect(markup).toContain('aria-label="Failed"');
	expect(markup).toContain('text-status-danger');
	expect(markup).toContain('lucide-x');
});
