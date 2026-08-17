# Schemas

Public JSON Schemas for the two configuration files Ensemblr reads. They are
published so an editor can complete, validate, and document a config file
without Ensemblr running.

| File | Schema | Describes |
| --- | --- | --- |
| `~/.config/ensemblr/config.json` | [`config.schema.json`](./config.schema.json) | User-scope App settings and declarative configuration. See [11. App settings](../docs/guide/11-app-settings.md). |
| `.ensemblr/settings.toml` | [`settings.schema.json`](./settings.schema.json) | A repository's committed per-repository settings. See [12. Repository settings](../docs/guide/12-repository-settings.md). |

Both are JSON Schema draft 2020-12. TOML has no schema language of its own;
[Taplo](https://taplo.tamasfe.dev/) — the engine behind the Even Better TOML
extension — validates TOML against JSON Schema, which is why `settings.toml`
gets one too.

## URLs

Each schema's canonical `$id` is under the product domain:

```
https://www.ensemblr.dev/schemas/config.schema.json
https://www.ensemblr.dev/schemas/settings.schema.json
```

Until the site serves those paths, reference the committed copies, which
resolve today:

```
https://raw.githubusercontent.com/ensemblr-hq/ensemblr/master/schemas/config.schema.json
https://raw.githubusercontent.com/ensemblr-hq/ensemblr/master/schemas/settings.schema.json
```

## Using them

**`config.json`** takes a `$schema` key. Ensemblr writes one into the file it
creates on first launch, so a config it made is already wired up; add the line
by hand to a config that predates it:

```json
{
	"$schema": "https://raw.githubusercontent.com/ensemblr-hq/ensemblr/master/schemas/config.schema.json",
	"schemaVersion": 1,
	"app": {}
}
```

`$schema` is accepted and ignored by the config loader — it is not a setting.

**`settings.toml`** takes Taplo's directive as its first line:

```toml
#:schema https://raw.githubusercontent.com/ensemblr-hq/ensemblr/master/schemas/settings.schema.json
```

A save from Repo settings → Scripts re-serialises the whole file and drops every
comment, but this one directive is read back and restored, so wiring a
repository up once survives.

This repository points its own `.ensemblr/settings.toml` at the checked-in file
with a relative path (`#:schema ../schemas/settings.schema.json`) so it
validates offline and always against the tree it ships with.

An editor can also be told directly, without a pointer in the file at all —
`.vscode/settings.json` in this repository maps `.ensemblr/settings.toml` that
way as a worked example. `config.json` gets no such mapping here: it lives at
`~/.config/ensemblr/config.json`, outside any workspace, and a workspace-scoped
`json.schemas` entry only applies to files inside the workspace. Its `$schema`
key is what wires it up.

## Keeping them honest

The schemas are hand-written, and `tests/main/published-schemas.test.ts` asserts
they still agree with the code: every key they declare is one the loader
accepts, every key the loader accepts is one they declare, and the enums match
the vocabularies the app validates against. A key added to a config file without
a matching schema entry fails that test.
