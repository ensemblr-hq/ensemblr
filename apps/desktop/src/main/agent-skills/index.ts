// Module boundary:
//   `agent-skills/` — Where the Agent Skill bundle Ensemblr ships lives on disk,
//                     addressed the way each runtime wants it. Owns path
//                     resolution only: the flags built from these paths belong
//                     to the adapter or launch-decoration module that spawns the
//                     runtime, not here.

export type { AgentSkillBundle } from './skill-bundle-paths';
export { resolveAgentSkillBundle } from './skill-bundle-paths';
