// @vitest-environment happy-dom

import { Skeleton } from '@ensemblr/ui';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

test('the desktop app consumes shared UI through its workspace package', () => {
	render(<Skeleton className='h-4 rounded-none' data-testid='skeleton' />);

	expect(screen.getByTestId('skeleton')).toHaveAttribute(
		'data-slot',
		'skeleton',
	);
	expect(screen.getByTestId('skeleton')).toHaveClass(
		'animate-pulse',
		'h-4',
		'rounded-none',
	);
	expect(screen.getByTestId('skeleton')).not.toHaveClass('rounded-md');
});
