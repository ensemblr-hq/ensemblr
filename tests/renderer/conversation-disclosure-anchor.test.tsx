// @vitest-environment happy-dom

/**
 * Opening a tool row grows the transcript, which the stick-to-bottom lock would
 * otherwise read as new output and answer by scrolling to the newest message —
 * dragging the row the user just opened off the top of the screen. These tests
 * drive the real Conversation/ToolCollapsible pair and assert that a row which
 * pushes the view away from the newest message releases the lock, that a row
 * small enough to keep the newest message in view leaves it armed, and that the
 * row stays put when the transcript shifts under it.
 */

import { fireEvent, screen } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ChatTurnSummary } from '../../src/renderer/components/chat-turn-summary';
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from '../../src/renderer/components/conversation';
import { ConversationViewportProvider } from '../../src/renderer/components/conversation/viewport-context';
import {
	StackTrace,
	StackTraceContent,
	StackTraceError,
	StackTraceErrorMessage,
	StackTraceFrames,
	StackTraceHeader,
} from '../../src/renderer/components/stack-trace';
import { ToolCollapsible } from '../../src/renderer/components/tool-collapsible';
import { useScrollAnchor } from '../../src/renderer/hooks/conversation/use-anchored-disclosure';
import { renderWithProviders } from './support/dom';

const VIEWPORT_SELECTOR = '[data-slot="conversation-scroll-area-viewport"]';
const BODY_TEXT = 'tool output';
const SCROLL_BUTTON_NAME = 'Scroll to newest message';
const CLIENT_HEIGHT = 400;
const SCROLLING_SCROLL_HEIGHT = 1000;

/** Renders one conversation holding a single tool row, and returns its viewport. */
function renderToolRow() {
	const view = renderWithProviders(
		<Conversation>
			<ConversationContent>
				<ToolCollapsible glyph='terminal' title='Ran a command'>
					<p>{BODY_TEXT}</p>
				</ToolCollapsible>
			</ConversationContent>
			<ConversationScrollButton />
		</Conversation>,
	);
	const viewport = view.container.querySelector(VIEWPORT_SELECTOR);
	if (!(viewport instanceof HTMLElement)) {
		throw new Error('conversation viewport did not render');
	}
	return { ...view, viewport };
}

/** Clicks the row's disclosure the way a user reaching for the body would. */
function openRow(): void {
	fireEvent.click(screen.getByRole('button', { name: 'Ran a command' }));
}

/**
 * happy-dom has no layout engine, so the transcript's heights have to be
 * stated: `collapsed` while the row's body is folded away and `expanded` once
 * it is on screen, against a tab of `CLIENT_HEIGHT`. `scrollTop` is clamped to
 * the scrollable range the way a real viewport clamps it, which is what makes a
 * transcript that fits its tab sit at offset zero.
 */
function stubTranscriptHeight({
	collapsed,
	expanded,
}: {
	collapsed: number;
	expanded: number;
}): void {
	let scrollTop = 0;
	Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
		configurable: true,
		get: () => CLIENT_HEIGHT,
	});
	Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
		configurable: true,
		get: () => (screen.queryByText(BODY_TEXT) === null ? collapsed : expanded),
	});
	Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
		configurable: true,
		get: () => scrollTop,
		set(next: number) {
			const furthest = Math.max(0, this.scrollHeight - this.clientHeight);
			scrollTop = Math.max(0, Math.min(next, furthest));
		},
	});
}

afterEach(() => {
	Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
	Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
	Reflect.deleteProperty(HTMLElement.prototype, 'scrollTop');
});

describe('tool row disclosure anchoring', () => {
	test('stops following the newest message when the opened body overflows the tab', () => {
		stubTranscriptHeight({
			collapsed: SCROLLING_SCROLL_HEIGHT,
			expanded: SCROLLING_SCROLL_HEIGHT + 600,
		});
		renderToolRow();

		openRow();

		expect(screen.getByText(BODY_TEXT)).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: SCROLL_BUTTON_NAME }),
		).toBeInTheDocument();
	});

	// The transcript the user reported: it fits the tab until the row opens, so
	// the growth past the bottom is small — small enough that a near-bottom test
	// would call it "still following" and let the lock scroll the row away.
	test('stops following even when the opened body only just overflows the tab', () => {
		stubTranscriptHeight({
			collapsed: CLIENT_HEIGHT,
			expanded: CLIENT_HEIGHT + 52,
		});
		renderToolRow();

		openRow();

		expect(
			screen.getByRole('button', { name: SCROLL_BUTTON_NAME }),
		).toBeInTheDocument();
	});

	test('keeps following the stream while the whole transcript still fits the tab', () => {
		stubTranscriptHeight({
			collapsed: CLIENT_HEIGHT - 200,
			expanded: CLIENT_HEIGHT - 20,
		});
		renderToolRow();

		openRow();

		expect(screen.getByText(BODY_TEXT)).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: SCROLL_BUTTON_NAME }),
		).not.toBeInTheDocument();
	});
});

describe('turn summary disclosure anchoring', () => {
	/** Renders a settled turn folded behind its summary chip. */
	function renderTurnSummary() {
		return renderWithProviders(
			<Conversation>
				<ConversationContent>
					<ChatTurnSummary
						durationMs={92_000}
						messageCount={4}
						toolGlyphs={['terminal', 'terminal']}
					>
						<p>{BODY_TEXT}</p>
					</ChatTurnSummary>
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>,
		);
	}

	test('stops following the newest message when a whole turn unfolds', () => {
		stubTranscriptHeight({
			collapsed: CLIENT_HEIGHT,
			expanded: CLIENT_HEIGHT + 900,
		});
		renderTurnSummary();

		fireEvent.click(
			screen.getByRole('button', { name: /2 tool calls, 4 messages/ }),
		);

		expect(screen.getByText(BODY_TEXT)).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: SCROLL_BUTTON_NAME }),
		).toBeInTheDocument();
	});
});

describe('tool row anchoring against a shifting transcript', () => {
	const CLOSED_ROW_TOP = 120;
	const DRIFT_PX = 60;

	// Keyed on whether the body is on screen, the way `stubTranscriptHeight` is,
	// so the drift the row sees follows the disclosure's state rather than how
	// many times anything happened to measure it.
	beforeEach(() => {
		Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
			configurable: true,
			value: function measureRow(this: HTMLElement) {
				if (this.dataset.role !== 'activity-row') {
					return { top: 0 } as DOMRect;
				}
				const opened = screen.queryByText(BODY_TEXT) !== null;
				return {
					top: opened ? CLOSED_ROW_TOP - DRIFT_PX : CLOSED_ROW_TOP,
				} as DOMRect;
			},
		});
	});

	afterEach(() => {
		Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect');
	});

	test('pulls the row back to where the user clicked it', () => {
		stubTranscriptHeight({
			collapsed: SCROLLING_SCROLL_HEIGHT,
			expanded: SCROLLING_SCROLL_HEIGHT + 600,
		});
		const { viewport } = renderToolRow();
		const before = viewport.scrollTop;

		openRow();

		expect(viewport.scrollTop).toBe(before - DRIFT_PX);
	});
});

describe('anchor lifetime', () => {
	/**
	 * A row whose capture and whose re-renders are driven separately, so a
	 * capture that never reaches a disclosure can be told apart from a later
	 * unrelated render.
	 */
	function AnchorHarness() {
		const { anchorRef, captureAnchor } = useScrollAnchor();
		const [renders, setRenders] = useState(0);

		return (
			<div data-role='activity-row' ref={anchorRef}>
				<button onClick={captureAnchor} type='button'>
					capture
				</button>
				<button onClick={() => setRenders(renders + 1)} type='button'>
					re-render {renders}
				</button>
			</div>
		);
	}

	/** Mounts the harness under a conversation that records what it is asked to hold. */
	function renderAnchorHarness() {
		const holdRowStill = vi.fn();
		renderWithProviders(
			<ConversationViewportProvider value={{ holdRowStill }}>
				<AnchorHarness />
			</ConversationViewportProvider>,
		);
		return { holdRowStill };
	}

	test('consumes a capture even when no disclosure follows it', () => {
		const { holdRowStill } = renderAnchorHarness();

		fireEvent.click(screen.getByRole('button', { name: 'capture' }));

		expect(holdRowStill).toHaveBeenCalledTimes(1);
	});

	test('never reuses a capture on a later unrelated render', () => {
		const { holdRowStill } = renderAnchorHarness();

		fireEvent.click(screen.getByRole('button', { name: 'capture' }));
		fireEvent.click(screen.getByRole('button', { name: /re-render/ }));
		fireEvent.click(screen.getByRole('button', { name: /re-render/ }));

		expect(holdRowStill).toHaveBeenCalledTimes(1);
	});

	test('leaves a row rendered outside a conversation alone', () => {
		renderWithProviders(<AnchorHarness />);

		expect(() =>
			fireEvent.click(screen.getByRole('button', { name: 'capture' })),
		).not.toThrow();
	});
});

describe('stack trace anchoring alongside a caller ref', () => {
	const TRACE = 'TypeError: boom\n    at run (/tmp/a.ts:1:1)';

	test('hands the caller the node and still anchors the row', () => {
		const holdRowStill = vi.fn();
		const callerRef = createRef<HTMLDivElement>();
		renderWithProviders(
			<ConversationViewportProvider value={{ holdRowStill }}>
				<StackTrace ref={callerRef} trace={TRACE}>
					<StackTraceHeader>
						<StackTraceError>
							<StackTraceErrorMessage />
						</StackTraceError>
					</StackTraceHeader>
					<StackTraceContent>
						<StackTraceFrames />
					</StackTraceContent>
				</StackTrace>
			</ConversationViewportProvider>,
		);

		expect(callerRef.current).toBeInstanceOf(HTMLDivElement);

		fireEvent.click(screen.getByText('boom'));

		expect(holdRowStill).toHaveBeenCalledTimes(1);
	});
});
