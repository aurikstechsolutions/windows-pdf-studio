---
name: Fixed app navigation
description: Persistent sidebar behavior across every Windows PDF Studio page.
---

Keep the left navigation anchored to the viewport while page content scrolls on every app route. On narrow screens, keep the compact horizontal navigation pinned at the top.

**Why:** the user explicitly asked that the left menu remain fixed on all pages.

**How to apply:** Make shared navigation positioning part of the app shell, not page-specific styles. Preserve independent scrolling within the rail when its links exceed the available viewport height.
