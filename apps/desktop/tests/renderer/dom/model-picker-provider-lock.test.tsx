// @vitest-environment happy-dom

/**
 * The rendered half of the per-chat provider pin — what `buildModelGroups`
 * cannot prove on its own. A locked row must stay in the list as a disabled
 * button, lose its digit shortcut so a digit always selects something, and
 * explain itself on hover. Also covers `ModelProviderIcon`, which keys its brand
 * mark off the runtime axis rather than the inference provider.
 */

import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ModelPicker } from '@/renderer/components/workbench-shell/conversation-panel/composer/model-picker';
import { ModelProviderIcon } from '@/renderer/components/workbench-shell/conversation-panel/composer/model-provider-icon';
import type { ComposerModelOption } from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';
import { asModelVendorId } from '@/shared/ipc/contracts/agent-models';
import { installLocalStorage, renderWithProviders } from '../support/dom';

const ANTHROPIC_VIEW_BOX = '0 0 24 24';
const CLAUDE_VIEW_BOX = '0 0 256 257';

function option(
	id: string,
	displayName: string,
	vendor: string,
	agentProvider: AgentProviderId,
): ComposerModelOption {
	return {
		agentProvider,
		contextWindow: 200_000,
		displayName,
		id,
		isDefault: false,
		vendor: asModelVendorId(vendor),
	};
}

/**
 * Four models across two runtimes. `Pi Haiku` and `Claude Opus` share the
 * `anthropic` group so the disabled state cannot be mistaken for grouping, and
 * the display names carry no digits so a row's shortcut is unambiguous in its
 * text content.
 */
const OPTIONS: readonly ComposerModelOption[] = [
	option('pi/haiku', 'Pi Haiku', 'anthropic', 'pi'),
	option('claude/opus', 'Claude Opus', 'anthropic', 'claude'),
	option('pi/gemini', 'Pi Gemini', 'google', 'pi'),
	option('claude/sonnet', 'Claude Sonnet', 'claude-code', 'claude'),
];

/** Renders the picker with its popover forced open so rows are queryable. */
function renderPicker(lockedProvider: AgentProviderId | null) {
	const onChange = vi.fn();
	renderWithProviders(
		<ModelPicker
			lockedProvider={lockedProvider}
			onChange={onChange}
			open={true}
			options={OPTIONS}
			value={null}
		/>,
	);
	return { onChange };
}

/** The select button of one model row, found by its display name. */
function rowButton(displayName: string): HTMLButtonElement {
	return screen.getByRole('button', {
		name: new RegExp(displayName),
	}) as HTMLButtonElement;
}

beforeEach(() => {
	installLocalStorage();
});

describe('ModelPicker provider lock', () => {
	test('renders every runtime’s models, locked ones as disabled buttons', () => {
		renderPicker('pi');

		expect(rowButton('Pi Haiku')).toBeEnabled();
		expect(rowButton('Pi Gemini')).toBeEnabled();
		expect(rowButton('Claude Opus')).toBeDisabled();
		expect(rowButton('Claude Sonnet')).toBeDisabled();
	});

	test('the mirror pin disables the Pi rows instead', () => {
		renderPicker('claude');

		expect(rowButton('Claude Opus')).toBeEnabled();
		expect(rowButton('Claude Sonnet')).toBeEnabled();
		expect(rowButton('Pi Haiku')).toBeDisabled();
		expect(rowButton('Pi Gemini')).toBeDisabled();
	});

	test('an unpinned chat leaves every row selectable', () => {
		renderPicker(null);

		for (const model of OPTIONS) {
			expect(rowButton(model.displayName)).toBeEnabled();
		}
	});

	test('locked rows carry no digit shortcut', () => {
		renderPicker('pi');

		expect(rowButton('Claude Opus')).toHaveTextContent(/^Claude Opus$/);
		expect(rowButton('Claude Sonnet')).toHaveTextContent(/^Claude Sonnet$/);
	});

	test('digits number every row when nothing is pinned', () => {
		renderPicker(null);

		expect(rowButton('Pi Haiku')).toHaveTextContent(/^Pi Haiku1$/);
		expect(rowButton('Claude Opus')).toHaveTextContent(/^Claude Opus2$/);
		expect(rowButton('Pi Gemini')).toHaveTextContent(/^Pi Gemini3$/);
		expect(rowButton('Claude Sonnet')).toHaveTextContent(/^Claude Sonnet4$/);
	});

	test('digits renumber over selectable rows only', () => {
		renderPicker('pi');

		expect(rowButton('Pi Haiku')).toHaveTextContent(/^Pi Haiku1$/);
		expect(rowButton('Pi Gemini')).toHaveTextContent(/^Pi Gemini2$/);
	});

	test('a locked row explains the pin on hover', async () => {
		renderPicker('pi');
		const trigger = rowButton('Claude Opus').closest(
			'[data-slot="tooltip-trigger"]',
		) as HTMLElement;

		fireEvent.pointerMove(trigger, { pointerType: 'mouse' });

		expect(await screen.findByRole('tooltip')).toHaveTextContent(
			'This chat runs on Pi. Start a new chat to switch provider.',
		);
	});

	test('a selectable row has no pin tooltip to show', () => {
		renderPicker('pi');

		expect(
			rowButton('Pi Haiku').closest('[data-slot="tooltip-trigger"]'),
		).toBeNull();
	});

	test('a locked row still renders its own runtime’s brand mark', () => {
		renderPicker('pi');

		const claudeRow = rowButton('Claude Opus');
		const piRow = rowButton('Pi Haiku');

		expect(claudeRow.querySelector('svg')).toHaveAttribute(
			'viewBox',
			CLAUDE_VIEW_BOX,
		);
		expect(piRow.querySelector('svg')).toHaveAttribute(
			'viewBox',
			ANTHROPIC_VIEW_BOX,
		);
	});
});

describe('ModelProviderIcon', () => {
	test('the Claude runtime wins over the inference provider', () => {
		const { container } = renderWithProviders(
			<ModelProviderIcon agentProvider='claude' vendor='anthropic' />,
		);
		const svg = container.querySelector('svg');

		expect(svg).toHaveAttribute('viewBox', CLAUDE_VIEW_BOX);
		expect(svg?.querySelector('path')?.getAttribute('d')).toMatch(
			/^m50\.228 170\.321/,
		);
	});

	test('a Pi chat on an Anthropic model keeps the Anthropic wordmark', () => {
		const { container } = renderWithProviders(
			<ModelProviderIcon agentProvider='pi' vendor='anthropic' />,
		);
		const svg = container.querySelector('svg');

		expect(svg).toHaveAttribute('viewBox', ANTHROPIC_VIEW_BOX);
		expect(svg?.querySelector('path')?.getAttribute('d')).toMatch(
			/^M17\.3041 3\.541/,
		);
	});

	test('the two runtimes draw different paths for the same inference provider', () => {
		const claude = renderWithProviders(
			<ModelProviderIcon agentProvider='claude' vendor='anthropic' />,
		);
		const pi = renderWithProviders(
			<ModelProviderIcon agentProvider='pi' vendor='anthropic' />,
		);
		const pathOf = (root: HTMLElement) =>
			root.querySelector('svg > path')?.getAttribute('d');

		expect(pathOf(claude.container)).not.toBe(pathOf(pi.container));
	});

	test('an unknown inference provider falls back to the sparkle', () => {
		const { container } = renderWithProviders(
			<ModelProviderIcon agentProvider='pi' vendor='lmstudio' />,
		);

		expect(container.querySelector('svg.lucide-sparkles')).not.toBeNull();
	});
});

describe('ModelPicker selection', () => {
	test('picking a selectable row reports the model id', async () => {
		const { onChange } = renderPicker('pi');

		await userEvent.click(rowButton('Pi Gemini'));

		expect(onChange).toHaveBeenCalledWith('pi/gemini');
	});

	test('a locked row cannot be picked', async () => {
		const { onChange } = renderPicker('pi');
		const locked = rowButton('Claude Opus');

		await userEvent.click(locked, { pointerEventsCheck: 0 });

		expect(onChange).not.toHaveBeenCalled();
	});
});

describe('ModelPicker rows stay visible, never hidden', () => {
	test('the pin renders one row per catalog model, locked ones included', () => {
		renderPicker('pi');

		expect(
			screen.getAllByRole('button', { name: 'Favourite model' }),
		).toHaveLength(OPTIONS.length);
		for (const model of OPTIONS) {
			expect(screen.getByText(model.displayName)).toBeVisible();
		}
	});

	test('every provider group keeps its label under a pin', () => {
		renderPicker('claude');

		for (const label of ['Anthropic', 'Gemini', 'Claude Code']) {
			expect(screen.getByText(label)).toBeInTheDocument();
		}
	});
});
