// @vitest-environment happy-dom

import { afterEach, expect, test, vi } from 'vitest';

import { DemoRuntime } from '../../demo/demo-runtime';
import { defineScenario } from '../../demo/scenario';
import agentsPanel from '../../demo/scenarios/agents-panel';

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

test('keeps a gesture pending until its lazily rendered target exists', () => {
	const runtime = new DemoRuntime(
		defineScenario({
			...agentsPanel,
			interactions: [{ kind: 'click', selector: '#late-button' }],
		}),
		Number.POSITIVE_INFINITY,
	);
	expect(runtime.applyNextInteraction()).toBe(true);
	const button = document.createElement('button');
	button.id = 'late-button';
	const click = vi.fn();
	button.onclick = click;
	document.body.append(button);
	expect(runtime.applyNextInteraction()).toBe(true);
	expect(click).toHaveBeenCalledOnce();
	expect(runtime.applyNextInteraction()).toBe(false);
});

test('scrolls the exact label instead of an ancestor containing the whole page', () => {
	document.body.innerHTML =
		'<div id="page"><div id="label">Delegation roles</div><div>Other settings</div></div>';
	const label = document.getElementById('label');
	const scroll = vi.fn();
	if (label) label.scrollIntoView = scroll;
	const runtime = new DemoRuntime(
		defineScenario({
			...agentsPanel,
			interactions: [
				{ kind: 'scroll-into-view', selector: 'div', text: 'Delegation roles' },
			],
		}),
		Number.POSITIVE_INFINITY,
	);
	expect(runtime.applyNextInteraction()).toBe(true);
	expect(scroll).toHaveBeenCalledOnce();
});
