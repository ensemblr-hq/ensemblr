// Module boundary:
//   `pi-ipc/` — Low-level transport plumbing shared between `pi-runtime/`
//                (RPC smoke check) and `pi-agent/` (live session adapter).
//                Pure utilities only; no Pi-specific protocol knowledge.

export type {
	JsonlLineStream,
	JsonlLineStreamOptions,
} from './jsonl-line-stream';
export { createJsonlLineStream } from './jsonl-line-stream';
