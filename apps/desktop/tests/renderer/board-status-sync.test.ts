// @vitest-environment happy-dom
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { installAgentControlBoardStatusSync } from '../../src/renderer/state/workspace';
import { workspaceBoardStatusAtom } from '../../src/renderer/state/workspace/structure-atoms';
import { clearEnsemblrApi, installEnsemblrApi } from './support/dom';

type BoardStatusListener = (payload: {
	workspaceId: string;
	status: string;
}) => void;

const store = getDefaultStore();

describe('installAgentControlBoardStatusSync', () => {
	let reportBoardStatus: ReturnType<typeof vi.fn>;
	let listener: BoardStatusListener | null;
	let teardown: () => void;

	beforeEach(() => {
		store.set(workspaceBoardStatusAtom, {});
		reportBoardStatus = vi.fn();
		listener = null;
		installEnsemblrApi({
			reportBoardStatus,
			onAgentControlBoardStatus: (cb: BoardStatusListener) => {
				listener = cb;
				return () => {
					listener = null;
				};
			},
		});
		teardown = installAgentControlBoardStatusSync();
	});

	afterEach(() => {
		teardown();
		clearEnsemblrApi();
	});

	test('reports the current map to main on startup', () => {
		expect(reportBoardStatus).toHaveBeenCalledWith({});
	});

	test('applies an inbound broadcast to the atom and reports the change', () => {
		listener?.({ workspaceId: 'ws', status: 'in-review' });
		expect(store.get(workspaceBoardStatusAtom)).toEqual({ ws: 'in-review' });
		expect(reportBoardStatus).toHaveBeenLastCalledWith({ ws: 'in-review' });
	});

	test('reports again when the atom changes locally', () => {
		reportBoardStatus.mockClear();
		store.set(workspaceBoardStatusAtom, { ws: 'done' });
		expect(reportBoardStatus).toHaveBeenCalledWith({ ws: 'done' });
	});
});
