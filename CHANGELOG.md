# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!--
  HOW TO USE
  ----------
  When opening a PR or making a commit, add your entries under [Unreleased].
  Use the section headings below — only include the ones that apply:

    ### Added      — new features
    ### Changed    — changes to existing behaviour
    ### Deprecated — features that will be removed in a future release
    ### Removed    — features removed in this release
    ### Fixed      — bug fixes
    ### Security   — security-related changes

  On release, rename [Unreleased] to the version + date, e.g.:
    ## [0.2.0] — 2026-09-01
  Then add a fresh empty [Unreleased] section at the top.

  Keep entries short and user-facing — one line per change where possible.
  Do not describe implementation details or intermediate states.
-->

---

## [Unreleased]

### Added

#### Explore
- Resizable split layout — drag the handle between the resource-type list and the object table to adjust the panel width.
- Solo-select category filter — clicking a category pill (`native`, `kcp`, `crd`, `apibinding`) isolates it; clicking again returns to all.
- Syntax-highlighted detail drawer — clicking any object opens a slide-in drawer rendering the full resource as YAML or JSON with token-level colour highlighting.
- `managedFields` toggle in the detail drawer — hidden by default, togglable via an eye button.
- Copy-to-clipboard button in the detail drawer header.

#### API Bindings
- Three-step creation wizard:
  1. **Workspace picker** — lazy-loaded tree of all workspaces.
  2. **Export picker** — lists all `APIExport`s in the chosen workspace; already-bound exports show an "Already bound" badge and are disabled.
  3. **Review & confirm** — editable binding name and a permission-claims table with per-claim Accept / Reject buttons.
- Smart polling after create or delete — polls until the binding appears or disappears, with a spinner and an amber "Timed out" indicator.
- Condition health grid in the binding detail panel, shown when the binding is degraded.

#### API Exports
- Export status badge derived from the condition array (Ready, No identity, No endpoints, …).
- Smart polling after create or delete.

#### Workspace sidebar
- Create-workspace modal with name input and workspace-type picker.
- Smart polling after create (until `Ready`) and after delete (until gone).

#### Shared
- `usePoller` composable — generic polling utility with configurable interval, timeout, and reactive state (`idle | polling | timeout`).
- `ConfirmDialog` component — reusable modal used for all destructive actions.
- `apiExportStatus()` and `apiBindingStatus()` helpers in `types/apis.ts`.

#### Demo mode
- `VITE_DEMO=true` activates MSW in the browser — no backend required.
- Mock data models the real kcp API surface (provider/consumer workspace tree, correct `apis.kcp.io/v1alpha2` shapes, simulated reconciliation delays).
- Run locally: `VITE_DEMO=true npm run dev --workspace web`

#### CI
- GitHub Actions workflow builds the static demo bundle and deploys it to GitHub Pages on every push to `main`.
