# Windows PDF Studio

A local-first Windows PDF utility for viewing, cropping, exporting, and printing documents, with an administrator-reviewed digital license flow.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/windows-pdf-studio run dev` — run the web preview
- `pnpm --filter @workspace/windows-pdf-studio run desktop:win` — build a portable Windows x64 `.exe`
- `pnpm --filter @workspace/windows-pdf-studio run desktop:installer` — build a Windows NSIS installer where compatible packaging support is available
- `pnpm --filter @workspace/windows-pdf-studio run desktop:test-unsigned` — make a test-only portable EXE; never distribute it, and use only in an isolated Windows test environment because Smart App Control blocks unsigned apps
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/windows-pdf-studio` — PDF workspace, print composer, license UI, and Electron shell
- `artifacts/windows-pdf-studio/src/lib/local-library.ts` — device-local IndexedDB library and print-job persistence
- `artifacts/api-server/src/routes/licensing.ts` — license requests, approvals, and activation API
- `lib/api-spec/openapi.yaml` — source of truth for API contracts
- `lib/db/src/schema/licensing.ts` — licensing records
- Generated Electron output goes to ignored `generated-artifacts/windows-pdf-studio/`

## Architecture decisions

- PDF and image bytes stay on the user's device; only license metadata is sent to the API.
- The file library and print-job snapshots persist in IndexedDB on the device; do not add cloud file uploads without explicit user approval.
- Mailbox connections are made directly from the Windows app over IMAP/SMTP; credentials are encrypted with Electron safeStorage and mail attachments are imported to local IndexedDB only after user action.
- Print history records that a print dialog was opened, not that a physical printer completed the job.
- License keys are generated on approval, shown once to the administrator, and stored server-side as SHA-256 hashes.
- Authentication is first-party: shop accounts are bound to one active license and installation; administrator accounts use the separate browser portal and are restricted to `LICENSE_ADMIN_EMAILS`.
- The first administrator is created once with `ADMIN_BOOTSTRAP_SECRET`; shop registration requires the approved license key and matching license email, while later sign-ins use email and password.
- The Windows app gates all desktop workspace routes behind a verified shop session. Before sign-in, show only shop registration/sign-in, license request, and license-service connection; after sign-in, land on Documents and keep License out of the workspace navigation. A previously verified shop session may open local PDF tools offline for up to 30 days, while server-backed shop actions still require the API.

## Product

- View and navigate PDF pages, select a crop region, and export pages or crops as PNG/JPG.
- Merge multiple local PDFs in the chosen order, save the combined PDF in the local File Manager, and download a device copy.
- Arrange uploaded image files and PDF pages on Letter, A4, Legal, or 4×6 sheets, preview the layout, and open the system print dialog.
- Import and organize local PDFs/images/exports in a searchable library with folders, favorites, rename, download, and recoverable trash; reopen saved print jobs with their settings.
- Connect a user's own IMAP/SMTP mailbox, review recent messages, and save supported PDF/image attachments into the local File Manager.
- Submit shop license requests, register a shop against an approved key, sign in to the existing shop account, and review pending licenses in the separate administrator portal.

## User preferences

- The user requested a professional Windows desktop application and specified PDF conversion, viewing/cropping, sheet sizing and placement, upload/preview/print, and digital license approval.

## Gotchas

- Set `LICENSE_ADMIN_EMAILS` to the authorized administrator emails and set `ADMIN_BOOTSTRAP_SECRET` before initial admin setup. Do not add public admin self-signup or role selection.
- Before license requests or activation can work in the installed desktop app, enter the published app origin (HTTPS) in License settings.
- The NSIS installer target requires a compatible Wine/Windows packaging environment; `desktop:win` builds the portable executable.
- Electron builds must use a relative Vite asset base (`BASE_PATH=./`) because the packaged renderer loads from `file://`; the web artifact keeps its configured base path.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
