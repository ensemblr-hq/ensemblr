## Ensemblr v0.1.2

**Quick Start can publish into a GitHub organization.** "Create project" could only ever create a repository under the signed-in user. It now offers a picker of every account you can publish into, and prefixes `gh repo create` with `OWNER/` when one is chosen. Visibility stays `--private` either way, and with no owner picked the argv is byte-identical to before.

Organizations you belong to but cannot publish into are **listed disabled behind a badge rather than hidden**, so an unavailable org explains itself — SAML SSO or an enterprise 2FA policy reads as `owner-access-restricted`, a repository-creation restriction as `owner-create-restricted`.

**A sent prompt keeps the chips the composer showed.** A chat transcript, a tracker issue, a patch and a review comment are all `.context/` documents addressed by a generated filename, so the sent bubble — which rebuilt its chips from the path alone — showed a bare `<uuid>.md` behind a generic file icon where the composer had shown a title and a mark. Both chips now resolve through one glyph resolver, and a transcript a sub-agent left behind wears a robot rather than a sparkle.

The rest of the release is three fixes: context menus that overflowed their rows in Russian and Greek, a Concierge reference chip that could not be named twice in one draft, and a running tool row that opened onto a placeholder repeating its own pulse.

### Install

macOS:

```sh
brew install --cask ensemblr-hq/tap/ensemblr
```

Linux:

```sh
curl -fsSL https://www.ensemblr.dev/install.sh | sh
```

The `.dmg` is signed with a Developer ID certificate, hardened-runtime, notarized by Apple and stapled, so it opens without a Gatekeeper prompt and validates offline. The Linux installer needs no root, writes nothing outside `$HOME`, verifies the download against the digest GitHub publishes, and keeps a manifest so `--uninstall` removes exactly what it added. Re-running it is an update.

### What's Changed since v0.1.1

#### Added

* **Quick Start publishes into a GitHub organization**: the "Create project" dialog gains an owner picker, and `gh repo create` is prefixed with `OWNER/` when one is chosen. Two `gh` calls back the list, issued concurrently because neither feeds the other — REST `user/orgs` enumerates memberships including concealed ones but carries no permission data, while GraphQL `viewer.organizations` carries `viewerCanCreateRepositories` but silently omits any org the token cannot reach. The difference between the two answers *is* the set of orgs you belong to but cannot publish into, which is what lets both restriction reasons be named rather than guessed. The last organization published into is remembered, honoured only while it is still listed and still creatable, so revoked access falls back to the personal account rather than failing at publish. A user who has never published into an org is never made to wait on `gh` and never sees the placeholder row; any failure yields an empty list and hides the picker entirely. (#429)

* **Attachment chip glyphs and titles cross into the sent prompt**: `AttachmentMark` is the flat glyph token that travels with the prompt and `AttachmentGlyph` the single resolver both the composer chip and the sent-message chip delegate to, so the two can no longer diverge. `<attached_file>` widens with optional `label` and `mark` attributes, written only where the path does not name itself — an ordinary `@src/foo.ts` mention's prompt bytes are unchanged, and the path keeps its quote-only escape so the agent still reads a filename that exists. A new `chat-transcript` composer attachment carries `isSubAgent`, and `isSubAgentTab` is extracted so the tab strip, the transcript chips and the Concierge `@` menu read that marker from one place. (#428)

#### Changed

* **The Linear person avatar is a rounded square**: every account avatar in the app chrome goes through `ProjectAvatar` and is a rounded square. `LinearAvatar` was the one that stayed a circle, so an issue row's assignee did not match the project avatar sitting a few pixels above it. `OwnerAvatar` is lifted out of the clone list for the same reason. (#429)

* **`docs/` audited against the code for 0.1.1**: every countable and structural claim verified rather than tidied — the ADR count and range, the `tests/main` and `tests/renderer` file counts, a missing shared concern pair, missing renderer `markdown/` subdirectories, and a `PINNED_MODELS` table enumerating three entries where the catalog carries four. Two gaps where a shipped feature contradicted a doc claiming completeness were filled: the Linux install script had no mention in the install guide, and Infisical setup was still described as "two halves" after `.infisical.json` became a third, discovered source. (#425)

#### Fixed

* **Context menus grow to fit a long label, and "New workspace" works**: menu rows were a fixed `h-8` inside fixed-width panels, so a label that wrapped in Russian or Greek overflowed its 32px box and drew on top of the row beneath it. Rows now take a `min-h-8` floor and panels size to their content under a `max-w-80` cap. Separately, the repository menu's "New workspace" item was rendered with no props at all — no `onSelect`, no `disabled` — so it highlighted on hover and did nothing on click, which is why the ⌘N accelerator worked while the item did not. (#426)

* **A Concierge reference chip can repeat within one draft**: naming the same workspace, repo or chat tab twice in one prompt was impossible, because the dedupe lived in the shared Lexical editor rather than in the Concierge. That is right for a file chip, whose bytes are inlined into the prompt so a repeat only spends budget, and wrong for a reference chip, which carries no content and stands where you put it in the sentence. Dedupe is now conditional on the attachment kind, and the guard tests for the reference payload rather than listing the kinds that carry it. (#427)

* **A running tool row no longer opens onto a bare placeholder**: a tool call still in flight projected a body whose only content was a "Running…" line — exactly what the row's own pulse already says. A plain tool row now disables the disclosure outright, while a subagent card contributes no body but stays expandable, because its nested rows arrive while the delegation runs and are worth opening onto. A disabled row also stops advertising an `aria-controls` idref that never resolved. (#430)

---

*Full changelog*: https://github.com/ensemblr-hq/ensemblr/compare/v0.1.1...v0.1.2
