// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArchiveIcon } from 'lucide-react';
import { expect, test, vi } from 'vitest';

import { Button } from '../../../src/renderer/components/ui/button';
import { renderWithProviders } from '../support/dom';

// A pending button used to say so in its label ("Deleting…"), which meant the
// only record of the run was a string every locale had to carry. The spinner
// replaced it, so these assertions are what keeps the state legible at all —
// including to a screen reader, which sees neither the spinner nor the CSS.

test('a pending button keeps its idle label and reports the run', () => {
	renderWithProviders(<Button pending>Delete</Button>);

	const button = screen.getByRole('button', { name: /delete/i });

	expect(button).toHaveAttribute('aria-busy', 'true');
	expect(button).toBeDisabled();
	expect(
		button.querySelector('[data-slot="button-spinner"]'),
	).toBeInTheDocument();
});

test('a pending button carries the run in its accessible name', () => {
	renderWithProviders(<Button pending>Delete</Button>);

	expect(
		screen.getByRole('button', { name: 'Delete In progress' }),
	).toBeInTheDocument();
});

test('sibling pending buttons are distinguishable by accessible name alone', () => {
	renderWithProviders(
		<>
			<Button pending>Unarchive</Button>
			<Button disabled>Unarchive</Button>
		</>,
	);

	expect(
		screen.getByRole('button', { name: 'Unarchive In progress' }),
	).toBeInTheDocument();
	expect(screen.getByRole('button', { name: 'Unarchive' })).not.toHaveAttribute(
		'aria-busy',
	);
});

test('an idle button renders no spinner and reports no run', () => {
	renderWithProviders(<Button>Delete</Button>);

	const button = screen.getByRole('button', { name: /delete/i });

	expect(button).not.toHaveAttribute('aria-busy');
	expect(button).not.toHaveAttribute('data-pending');
	expect(button.querySelector('[data-slot="button-spinner"]')).toBeNull();
});

test('a pending button keeps its own icon mounted for the stylesheet to hide', () => {
	renderWithProviders(
		<Button pending>
			<ArchiveIcon aria-hidden='true' data-icon='inline-start' />
			Archive
		</Button>,
	);

	const button = screen.getByRole('button', { name: /archive/i });

	expect(button.querySelectorAll('svg')).toHaveLength(2);
	expect(button).toHaveAttribute('data-pending', 'true');
});

test('a pending button swallows the clicks its handler must not see twice', async () => {
	const onClick = vi.fn();
	renderWithProviders(
		<Button onClick={onClick} pending>
			Save
		</Button>,
	);

	await userEvent.click(screen.getByRole('button', { name: /save/i }));

	expect(onClick).not.toHaveBeenCalled();
});

test('an asChild button slots its child rather than rendering a button', () => {
	renderWithProviders(
		<Button asChild>
			<a href='https://ensemblr.dev'>Docs</a>
		</Button>,
	);

	const link = screen.getByRole('link', { name: 'Docs' });

	expect(link).toHaveAttribute('data-slot', 'button');
	expect(link.querySelector('[data-slot="button-spinner"]')).toBeNull();
});

test('pending is unassignable alongside asChild, which cannot honour it', () => {
	const banned = (
		// @ts-expect-error the slot branch has no `disabled` to set, so the prop type bans the pair rather than dropping it silently.
		<Button asChild pending>
			<a href='https://ensemblr.dev'>Docs</a>
		</Button>
	);

	expect(banned).toBeTruthy();
});
