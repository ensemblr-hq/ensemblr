/**
 * Public runtime surface of `lib/pi-replay`: the pure reducer that folds raw Pi
 * RPC frames from `tests/fixtures/pi-captures/` into a renderable timeline, and
 * the capture replayer that drives it. Dev-only — the live conversation is
 * built by the provider-neutral mappers in `@/renderer/lib/agent-timeline`.
 */

export { createPiTimelineState, reducePiTimeline } from './reducer.ts';
export { capturedLinesToInputs, replayPiTimeline } from './replay.ts';
export { summarizeToolCall } from './tool-summary.ts';
