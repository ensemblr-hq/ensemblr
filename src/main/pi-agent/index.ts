// Module boundary:
//   `agent-runtime/` — Provider-neutral agent vocabulary, adapter contract, the
//                      client that dispatches across providers, and the session
//                      service, persistence, naming, and summaries built on top
//                      of them. Owns everything no single runtime is special in.
//   `pi-runtime/`    — Pi binary surface: executable resolution, readiness
//                      probing, RPC smoke, provider models, agent-directory
//                      resolver. Answers "is Pi installed and runnable?".
//   `pi-agent/`      — The Pi adapter (`pi --mode rpc`): its RPC wire frames,
//                      its payload normalizer, and its slash commands. A sibling
//                      of `claude-agent/`, not its parent.
//   `pi-ipc/`        — Low-level transport plumbing (JSONL framing) shared
//                      between `pi-runtime/` smoke check and `pi-agent/` adapter.

export type {
	ChildLike,
	CreatePiCliRpcAdapterOptions,
	SpawnFn,
} from './pi-cli-rpc-adapter';
export {
	createPiCliRpcAdapter,
	normalizePiPayload,
} from './pi-cli-rpc-adapter';
export { resolvePiSlashCommands } from './pi-slash-commands';
