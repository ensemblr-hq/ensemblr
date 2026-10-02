import { atom } from 'jotai';

import type { UpdateStatusSnapshot } from '@/shared/ipc/contracts/update';

/**
 * The updater's state as main last reported it, or null until the first read
 * lands. Not persisted — every value here describes the running process, and a
 * stale one restored from a previous launch would claim an update is staged
 * that Squirrel already installed.
 */
export const updateStatusAtom = atom<UpdateStatusSnapshot | null>(null);
