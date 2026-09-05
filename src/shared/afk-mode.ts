/**
 * Public entrypoint for AFK Mode's enforcement policy. Import the control-op
 * classifier from here rather than the `afk-mode/` implementation file.
 *
 * AFK Mode is Plan Mode's opposite number and shares its shape: policy lives in
 * `shared/` and is reached over the agent-control server, because the shipped Pi
 * extension cannot import from `src/` at runtime. It is deliberately much
 * smaller — Plan Mode restricts what an agent may *do*, while AFK Mode only
 * closes the surfaces that park a turn waiting on a human who is not there.
 *
 * The two are mutually exclusive: Plan Mode's whole purpose is to stop and ask.
 * The renderer clears one when the other is turned on, and the IPC handlers
 * clear the registry entry to match.
 */
export { afkModeControlOpDenial } from './afk-mode/control-ops.ts';
