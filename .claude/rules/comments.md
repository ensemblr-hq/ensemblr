# Comment Policy

Function bodies contain no comments. The code carries the meaning. A comment inside a body is a signal that a name is wrong or that the function is doing too much — treat it as a refactoring prompt, not as documentation.

This rule governs comments *inside* code. For the JSDoc block *above* a declaration, see [jsdoc.md](./jsdoc.md).

## Removing A Comment

When a body comment feels necessary, one of these removes the need for it:

- **Rename** the variable, parameter, or helper so the comment becomes redundant.
- **Lift** a complex condition or expression into a well-named local.
- **Name the value** — replace a magic number or string with a named constant.
- **Extract** a commented "section" of a long function into a named helper.
- **Type it** — encode the constraint in the type instead of describing it in prose.

```ts
// Wrong — a section comment splitting one function into phases.
function publishRelease(release: Release): PublishResult {
  // validate the release before we touch the registry
  if (!release.tag || release.assets.length === 0) return { ok: false };
  if (release.tag.startsWith("v") === false) return { ok: false };
  // upload every asset, then flip the flag
  for (const asset of release.assets) uploadAsset(asset);
  return { ok: markPublished(release) };
}

// Right — the extracted helpers say what the comments said.
function publishRelease(release: Release): PublishResult {
  if (!isPublishable(release)) return { ok: false };
  uploadAssets(release.assets);
  return { ok: markPublished(release) };
}
```

## The One Exception: A Non-Obvious Why

A short comment is allowed only for something the code cannot express on its own: an external constraint, a spec quirk, an upstream bug workaround, a deliberate deviation, or a measured performance trade-off.

Apply this test: would a competent reader, looking at correct code, plausibly "fix" it into a bug? If yes, the comment earns its place.

Keep it to one or two lines, place it directly above the line it explains, and state the constraint rather than the mechanism. Never write a comment that restates what the code already says.

```ts
// Wrong — the comment restates the code.
retries = retries + 1; // increment the retry counter

// Right — the code speaks for itself.
retries = retries + 1;

// Allowed — explains a non-obvious why the code cannot express.
// Stripe rejects amounts over 8 digits, so cap before the charge call.
const chargeable = Math.min(amount, MAX_STRIPE_AMOUNT);
```

## Outside This Rule

These are not body comments and stay as they are:

- JSDoc blocks above declarations, per [jsdoc.md](./jsdoc.md).
- Tool directives: `biome-ignore`, `@ts-expect-error`, `// @vitest-environment happy-dom`, and similar.
- File-level prologue or license headers.

## Never Allowed

- **Commented-out code.** Delete it; git holds the history.
- **Bare `TODO` / `FIXME` prose.** File a Linear issue instead and let the tracker carry the work — see the Linear workflow section in `AGENTS.md`.

## Scope

Applies to `src/**` and `scripts/**`. Tests are exempt from the JSDoc requirement but follow the same comment discipline.

The JSDoc block documents the contract; clear code documents the mechanism. Comments that echo the code rot and add noise.
