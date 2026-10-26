---
name: PDF editing behavior
description: The product requirement for directly editing content on the original PDF pages.
---

The Edit workspace should show the original rendered PDF pages and let the user click existing text to edit it in place, or click a location to add text or other content. The Select tool should also reopen a previous replacement so its text and font family, weight, italic style, colour, and size can be adjusted manually. Preserve the page layout; do not reflow the document into new paragraphs. Replacement masks must align to the source text baseline and font metrics rather than a fixed vertical offset. Preserve detected styling and embedded source fonts when possible. Validate styling against real source PDFs; a synthetic export test alone does not establish a visual match.

**Why:** the user clarified that the reflow editor was wrong; they expect a real PDF view with direct on-page editing, manual style correction, precise cover placement, and original typography, and later identified a visible mismatch after a synthetic sample passed.

**How to apply:** keep the source PDF unchanged, preserve page coordinates and existing artwork, let users reselect prior replacements in Select mode, save manual style overrides with each edit, use source font ascent/descent for masks, compare replacements with the actual original page, and disclose limits when an element cannot be edited reliably.
