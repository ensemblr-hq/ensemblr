import { describe, expect, it } from 'vitest';

import {
	LINEAR_ASSET_SCHEME,
	parseLinearAssetUrl,
	proxyLinearAssetImages,
	stripLinearAssetSignatures,
} from '@/shared/linear-assets';

const ACCOUNT_ID = '1ef5f628-0386-40d3-8ab1-fded1e0989bb';
const ASSET_PATH =
	'/a6df2ddd-e6b1-4cc5-88e0-5cbc65b52b5b/65637a14-7860-4cd4-bb27-19b6bb6a0bc0/e1bf3de8-93e3-43d4-9e45-646a2ae65af6';
const SIGNED_URL = `https://uploads.linear.app${ASSET_PATH}?signature=eyJhbGciOiJIUzI1NiJ9.eyJpYXQiOjF9.Zu-f3bFrpVB5`;
const CANONICAL_URL = `https://uploads.linear.app${ASSET_PATH}`;

describe('stripLinearAssetSignatures', () => {
	it('drops the expiring signature from an embedded image', () => {
		expect(stripLinearAssetSignatures(`![shot](${SIGNED_URL})`)).toBe(
			`![shot](${CANONICAL_URL})`,
		);
	});

	it('drops it from an attachment link and a bare URL alike', () => {
		expect(
			stripLinearAssetSignatures(
				`See [the file](${SIGNED_URL}) or ${SIGNED_URL}.`,
			),
		).toBe(`See [the file](${CANONICAL_URL}) or ${CANONICAL_URL}.`);
	});

	it('keeps sentence punctuation that follows a bare URL', () => {
		expect(
			stripLinearAssetSignatures(`Look at ${CANONICAL_URL}, then stop.`),
		).toBe(`Look at ${CANONICAL_URL}, then stop.`);
	});

	it('leaves other hosts and empty bodies untouched', () => {
		expect(
			stripLinearAssetSignatures('![x](https://example.com/a.png?signature=k)'),
		).toBe('![x](https://example.com/a.png?signature=k)');
		expect(stripLinearAssetSignatures(null)).toBeNull();
	});
});

describe('proxyLinearAssetImages', () => {
	it('points an embedded image at the account-scoped scheme', () => {
		expect(
			proxyLinearAssetImages(`![shot](${CANONICAL_URL})`, ACCOUNT_ID),
		).toBe(`![shot](${LINEAR_ASSET_SCHEME}://${ACCOUNT_ID}${ASSET_PATH})`);
	});

	it('handles an angle-bracketed destination and a title', () => {
		expect(
			proxyLinearAssetImages(`![a](<${CANONICAL_URL}>)`, ACCOUNT_ID),
		).toContain(`![a](<${LINEAR_ASSET_SCHEME}://${ACCOUNT_ID}${ASSET_PATH}>`);
		expect(
			proxyLinearAssetImages(`![a](${CANONICAL_URL} "t")`, ACCOUNT_ID),
		).toBe(`![a](${LINEAR_ASSET_SCHEME}://${ACCOUNT_ID}${ASSET_PATH} "t")`);
	});

	it('drops a signature that survived into the renderer', () => {
		expect(proxyLinearAssetImages(`![a](${SIGNED_URL})`, ACCOUNT_ID)).toBe(
			`![a](${LINEAR_ASSET_SCHEME}://${ACCOUNT_ID}${ASSET_PATH})`,
		);
	});

	it('leaves a plain link to an attachment as an openable https URL', () => {
		expect(
			proxyLinearAssetImages(`[report.pdf](${CANONICAL_URL})`, ACCOUNT_ID),
		).toBe(`[report.pdf](${CANONICAL_URL})`);
	});

	it('refuses an account id that is not one', () => {
		expect(proxyLinearAssetImages(`![a](${CANONICAL_URL})`, '../../etc')).toBe(
			`![a](${CANONICAL_URL})`,
		);
	});
});

describe('parseLinearAssetUrl', () => {
	it('resolves a proxy URL to its account and upstream asset', () => {
		expect(
			parseLinearAssetUrl(
				`${LINEAR_ASSET_SCHEME}://${ACCOUNT_ID}${ASSET_PATH}`,
			),
		).toEqual({ accountId: ACCOUNT_ID, assetUrl: CANONICAL_URL });
	});

	it('pins the upstream origin so a traversal cannot steer the fetch', () => {
		expect(
			parseLinearAssetUrl(
				`${LINEAR_ASSET_SCHEME}://${ACCOUNT_ID}/../../evil.com/a`,
			),
		).toEqual({
			accountId: ACCOUNT_ID,
			assetUrl: 'https://uploads.linear.app/evil.com/a',
		});
	});

	it('rejects another scheme, an empty path, and a hostile account id', () => {
		expect(
			parseLinearAssetUrl(`https://uploads.linear.app${ASSET_PATH}`),
		).toBeNull();
		expect(
			parseLinearAssetUrl(`${LINEAR_ASSET_SCHEME}://${ACCOUNT_ID}/`),
		).toBeNull();
		expect(parseLinearAssetUrl(`${LINEAR_ASSET_SCHEME}://a_b/x`)).toBeNull();
		expect(parseLinearAssetUrl('not a url')).toBeNull();
	});
});
