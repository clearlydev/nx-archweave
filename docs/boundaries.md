# Enforced boundaries (full-stack)

English | [한국어](ko-KR/boundaries.md)

When you pick a backend, the workspace comes out in this shape. The arrows aren't just documentation: between the projects nx-archweave tags, they're enforced as lint errors (`@nx/enforce-module-boundaries`):

```
apps/
  web    (React/Next, FSD Lite rule)    ──┐
                                          ├──▶  libs/shared-types (scope:shared)
  api    (Express/Nest, official shape) ──┘
```

## The rules

The rules work as a deny list:

| Tag | Rule |
| --- | --- |
| `scope:frontend` | may never depend on `scope:backend` |
| `scope:backend` | may never depend on `scope:frontend` |
| `scope:shared` | stays side-free |

- **Your graph keeps working.** Nx generates an allow-all baseline, and these three rules sit on top of it. A dependency has to pass both. So your existing project graph keeps working untouched. Only imports between tagged frontend and backend projects become lint errors. A project with none of the three tags isn't covered, so tag the libraries you add (see below).
- **The apps are tagged for you.** To extend the net, tag backend-only libraries `scope:backend` and frontend-only libraries `scope:frontend`. The same rules then cover those libraries too.
- **Your AI agents know the tags.** With a backend, the agent-rules block gets a "Module Boundaries" section. It names these three tags (or the ones you set in `toolkit.config.json`) and tells the agent to tag a new library right away, for example `nx g @nx/js:lib libs/<name> --tags=scope:shared`.
- **`doctor` keeps watching.** If your config is still on the bare allow-all default, the `boundary-constraints-applied` check reports "boundaries are NOT enforced". The `boundary-untagged-projects` check lists every project (e2e projects aside) that carries none of the three tags, because the rules don't cover it.

> [!NOTE]
> **nx-archweave never rewrites your ESLint config blindly.** If it doesn't recognize something in your ESLint config, it leaves that part byte-for-byte untouched and gives you a paste-ready snippet instead.

## Existing workspaces

- `add-backend` finds the frontend app and the `api` app by their declared `projectType`. If a project doesn't declare one, it uses the type Nx infers.
- That means it also works in workspaces made with the classic `react-monorepo` preset, whose apps are plain `package.json` projects.
- If the `api` app is missing, `add-backend` refuses and prints the official commands to create it next to the frontend (`apps/api`).
- **Your own tags.** If the workspace already has a tag scheme, name the role tags in `toolkit.config.json`. `add-backend` then tags the apps, writes the deny rules, and `doctor` checks them with those names. A tag already present is never added twice, and existing tags are never removed.
- **Your own shared-types location, or none.** `sharedTypes` moves the lib and its import path, or turns it off.

```jsonc
{
  "boundaries": { "tags": { "frontend": "type:web", "backend": "type:api", "shared": "type:shared" } },
  "sharedTypes": { "path": "packages/types", "importPath": "@acme/types" }  // or false
}
```

> [!NOTE]
> **Express 4.** Say you pick Express in a workspace whose `@nx/react` expects Express 4. The printed commands first declare `express` in that range, so npm doesn't reject the generated app.
