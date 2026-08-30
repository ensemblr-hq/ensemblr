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
 * Reads the class list from the `-webkit-app-region: drag` rule so the hook's
 * hand-maintained copy is checked against the stylesheet rather than trusted.
 */
function readDragRegionClassesFromStylesheet(): string[] {
	const stylesheet = readFileSync(STYLESHEET_PATH, 'utf8');
	const rule = stylesheet.match(
		/((?:\s*\.[\w-]+,?)+)\s*\{[^}]*-webkit-app-region:\s*drag[^}]*\}/,
	);

	if (!rule?.[1]) {
		throw new Error('No -webkit-app-region: drag rule found in index.css');
	}

	return rule[1]
		.split(',')
		.map((selector) => selector.trim())
		.filter(Boolean)
		.sort();
}

test('the hook covers exactly the strips the stylesheet declares draggable', () => {
	const declared = readDragRegionClassesFromStylesheet();
	const covered = DRAG_REGION_SELECTOR.split(',')
		.map((selector) => selector.trim())
		.sort();

	expect(covered).toEqual(declared);
});

test('a double-click on a drag strip toggles maximize', () => {
	const toggle = renderDragRegion(
		<header className='native-toolbar'>
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

test.each(['button', 'a', 'input', '[role="button"]'])(
	'a double-click on %s inside a drag strip is left to the control',
	(selector) => {
		const toggle = renderDragRegion(
			<header className='native-toolbar'>
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
		<header className='window-drag-region'>
			<span>Strip</span>
		</header>,
	);

	fireEvent.dblClick(document.querySelector('span') as Element, { detail: 1 });

	expect(toggle).not.toHaveBeenCalled();
});

test('maximizing from a toolbar name drops the selection the double-click made', () => {
	const toggle = renderDragRegion(
		<header className='window-chrome-spacer'>
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
