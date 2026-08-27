// @vitest-environment happy-dom

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MessageResponse } from '@/renderer/components/message';
import { renderWithProviders, stubClipboard } from '../support/dom';

const HEADERLESS_TABLE = ['|  |  |', '| --- | --- |', '| a | b |'].join('\n');

const LABELLED_TABLE = ['| Name | Age |', '| --- | --- |', '| a | b |'].join(
	'\n',
);

const BLANK_CELL_TABLE = ['| Name |  |', '| --- | --- |', '| a | b |'].join(
	'\n',
);

const IMAGE_HEADER_TABLE = [
	'| ![chart](https://example.com/chart.png) |  |',
	'| --- | --- |',
	'| a | b |',
].join('\n');

const HEADER_ONLY_TABLE = ['|  |  |', '| --- | --- |', '', 'after'].join('\n');

const LABELLED_HEADER_ONLY_TABLE = ['| Name | Age |', '| --- | --- |'].join(
	'\n',
);

describe('a markdown table whose header row is empty', () => {
	test('drops the header band and keeps the body rows', async () => {
		renderWithProviders(<MessageResponse>{HEADERLESS_TABLE}</MessageResponse>);

		const table = await screen.findByRole('table');
		expect(table.querySelector('thead')).toBeNull();
		expect(screen.queryAllByRole('columnheader')).toHaveLength(0);
		expect(screen.getByRole('cell', { name: 'a' })).toBeInTheDocument();
		expect(screen.getByRole('cell', { name: 'b' })).toBeInTheDocument();
	});

	test('keeps the header band when any header cell carries content', async () => {
		renderWithProviders(<MessageResponse>{LABELLED_TABLE}</MessageResponse>);

		const table = await screen.findByRole('table');
		expect(table.querySelector('thead')).not.toBeNull();
		expect(screen.queryAllByRole('columnheader')).toHaveLength(2);
	});

	test('keeps a header band that labels only some of its columns', async () => {
		renderWithProviders(<MessageResponse>{BLANK_CELL_TABLE}</MessageResponse>);

		const table = await screen.findByRole('table');
		expect(table.querySelector('thead')).not.toBeNull();
		expect(
			screen.getByRole('columnheader', { name: 'Name' }),
		).toBeInTheDocument();
	});

	test('keeps a header band whose only content carries no text', async () => {
		renderWithProviders(
			<MessageResponse>{IMAGE_HEADER_TABLE}</MessageResponse>,
		);

		const table = await screen.findByRole('table');
		expect(table.querySelector('thead')).not.toBeNull();
		expect(table.querySelector('thead img')).not.toBeNull();
	});

	test('copies back the Markdown the agent wrote', async () => {
		const written = stubClipboard();
		renderWithProviders(<MessageResponse>{HEADERLESS_TABLE}</MessageResponse>);
		await screen.findByRole('table');

		fireEvent.click(screen.getByLabelText('Copy table'));

		await waitFor(() => expect(written).toHaveLength(1));
		expect(written[0].text).toBe(HEADERLESS_TABLE);
	});
});

describe('a markdown table with no body rows', () => {
	test('drops the table outright when its header was the only thing in it', async () => {
		const { container } = renderWithProviders(
			<MessageResponse>{HEADER_ONLY_TABLE}</MessageResponse>,
		);

		await screen.findByText('after');
		expect(container.querySelector('table')).toBeNull();
	});

	test('keeps a table whose header labels its columns', async () => {
		renderWithProviders(
			<MessageResponse>{LABELLED_HEADER_ONLY_TABLE}</MessageResponse>,
		);

		const table = await screen.findByRole('table');
		expect(screen.queryAllByRole('columnheader')).toHaveLength(2);
		expect(table.querySelector('tbody tr')).toBeNull();
	});
});
