/// <reference types="bun" />

import { describe, expect, test } from 'bun:test';

import { parsePmsetBattery } from '../../src/main/pi-agent/macos-battery';

describe('parsePmsetBattery', () => {
	test('reads a discharging laptop (not charging)', () => {
		const output =
			"Now drawing from 'Battery Power'\n -InternalBattery-0 (id=12345)\t87%; discharging; 4:12 remaining present: true";
		expect(parsePmsetBattery(output)).toEqual({ charging: false, percent: 87 });
	});

	test('reads a charging laptop', () => {
		const output =
			"Now drawing from 'AC Power'\n -InternalBattery-0 (id=12345)\t42%; charging; 1:03 remaining present: true";
		expect(parsePmsetBattery(output)).toEqual({ charging: true, percent: 42 });
	});

	test('reads a fully charged laptop on AC', () => {
		const output =
			"Now drawing from 'AC Power'\n -InternalBattery-0 (id=12345)\t100%; charged; 0:00 remaining present: true";
		expect(parsePmsetBattery(output)).toEqual({ charging: true, percent: 100 });
	});

	test('does not mistake "discharging" for charging', () => {
		const output = '-InternalBattery-0\t9%; discharging; 0:30 remaining';
		expect(parsePmsetBattery(output)).toEqual({ charging: false, percent: 9 });
	});

	test('returns null for a desktop with no battery', () => {
		expect(parsePmsetBattery("Now drawing from 'AC Power'\n")).toBeNull();
	});
});
