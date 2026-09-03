// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fireEvent, render } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import {
	DRAG_REGION_SELECTOR,
	useDragRegionDoubleClick,
} from '../../src/renderer/components/workbench-shell/window-controls/use-drag-region-double-click';

// happy-dom rewrites `import.meta.url` to an http origin, so the stylesheet is
// resolved from the Vitest root instead.
const STYLESHEET_PATH = path.join(
	process.cwd(),
	'src/renderer/styles/index.css',
);

/** Mounts the hook with a spy toggle and renders a fixture strip to click on. */
function renderDragRegion(children: React.ReactNode) {
	const toggle = vi.fn();

	/** Fixture host that only exists to run the hook under test. */
	function Host() {
		useDragRegionDoubleClick(toggle);
		return <>{children}</>;
	}

	render(<Host />);

	return toggle;
}

/**
 * Parses every `-webkit-app-region: drag` rule out of the stylesheet, comments
 * stripped, so the hook's hand-maintained selector is checked against the CSS
 * regardless of the order the rules appear in. A rule is `gated` when its
 * selector is scoped — as the macOS-only `inset-window-controls` toolbars are —
 * rather than a bare class the hook runs against on every platform.
 */
function readDragRules(): {
	classes: string[];
	gated: boolean;
	prelude: string;
}[] {
	const stylesheet = readFileSync(STYLESHEET_PATH, 'utf8').replace(
		/\/\*[\s\S]*?\*\//g,
		'',
	);
	const rules = [
		...stylesheet.matchAll(
			/([^{}]+)\{[^{}]*-webkit-app-region:\s*drag\b[^{}]*\}/g,
		),
	].map((match) => {
		const parts = match[1]
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean);

		return {
			classes: parts
				.map((part) => part.match(/\.[\w-]+$/)?.[0] ?? '')
				.filter(Boolean)
				.sort(),
			gated: !parts.every((part) => /^\.[\w-]+$/.test(part)),
			prelude: parts.join(', '),
		};
	});

	if (rules.length === 0) {
		throw new Error('No -webkit-app-region: drag rule found in index.css');
	}

	return rules;
}

test('the hook covers exactly the ungated strips the stylesheet declares draggable', () => {
	const ungated = readDragRules().filter((rule) => !rule.gated);
	expect(ungated).toHaveLength(1);

	const covered = DRAG_REGION_SELECTOR.split(',')
		.map((selector) => selector.trim())
		.sort();

	expect(covered).toEqual(ungated[0].classes);
});

test('the app toolbars drag only under the macOS inset-controls marker', () => {
	const gated = readDragRules().filter((rule) => rule.gated);
	expect(gated.length).toBeGreaterThan(0);

	for (const rule of gated) {
		expect(rule.prelude).toContain('inset-window-controls');
	}
});

test('a double-click on the title bar toggles maximize', () => {
	const toggle = renderDragRegion(
		<header className='window-title-bar'>
			<span>Workspace</span>
		</header>,
	);

	fireEvent.dblClick(document.querySelector('span') as Element, { detail: 2 });

	expect(toggle).toHaveBeenCalledTimes(1);
});

test('a double-click outside every drag strip is ignored', () => {
	const toggle = renderDragRegion(<main>Body</main>);

	fireEvent.dblClick(document.querySelector('main') as Element, { detail: 2 });

	expect(toggle).not.toHaveBeenCalled();
});

test('a double-click on a plain app toolbar does not toggle', () => {
	const toggle = renderDragRegion(
		<header className='native-toolbar'>
			<span>Workspace</span>
		</header>,
	);

	fireEvent.dblClick(document.querySelector('span') as Element, { detail: 2 });

	expect(toggle).not.toHaveBeenCalled();
});

test.each(['button', 'a', 'input', '[role="button"]'])(
	'a double-click on %s inside a drag strip is left to the control',
	(selector) => {
		const toggle = renderDragRegion(
			<header className='window-title-bar'>
				<button type='button'>Press</button>
				<a href='https://ensemblr.dev'>Open the Ensemblr site</a>
				<input readOnly value='' />
				{/** biome-ignore lint/a11y/useSemanticElements: fixture for the exclusion rule */}
				<span role='button' tabIndex={0}>
					Custom
				</span>
			</header>,
		);

		fireEvent.dblClick(document.querySelector(selector) as Element, {
			detail: 2,
		});

		expect(toggle).not.toHaveBeenCalled();
	},
);

test('a single click that bubbles as dblclick without detail 2 is ignored', () => {
	const toggle = renderDragRegion(
		<header className='window-title-bar'>
			<span>Strip</span>
		</header>,
	);

	fireEvent.dblClick(document.querySelector('span') as Element, { detail: 1 });

	expect(toggle).not.toHaveBeenCalled();
});

test('maximizing from a title-bar name drops the selection the double-click made', () => {
	const toggle = renderDragRegion(
		<header className='window-title-bar'>
			<span>Workspace name</span>
		</header>,
	);
	const removeAllRanges = vi.fn();
	vi.spyOn(window, 'getSelection').mockReturnValue({
		removeAllRanges,
	} as unknown as Selection);

	fireEvent.dblClick(document.querySelector('span') as Element, { detail: 2 });

	expect(removeAllRanges).toHaveBeenCalledTimes(1);
	expect(toggle).toHaveBeenCalledTimes(1);
});
