---
name: Print-shop QR ownership
description: Product constraints for the shared shop dashboard and customer QR workflow.
---

Each licensed Windows installation owns one shop profile and permanent customer QR. Do not create separate shop accounts. The installed client is the shop dashboard; central license administration belongs in a separate browser portal, not the shop navigation. Every customer's submission must remain its own request, with its own files, tracking code, and status history; never combine different customers' files.

Authentication is first-party, with no external identity provider. For a new shop, validate the approved license key first; only then show account creation using the license’s matching email and a password. Returning shops sign in with email and password. The central administrator uses a separate browser portal and one-time bootstrap secret.

**Why:** the user’s sales model is one login per installed EXE, each install is a shop, and the license must be confirmed before any new-shop account fields appear.

The Windows renderer must gate the entire shop workspace before mounting its routes or local file state. Before authentication, show only shop registration/sign-in, license-request, and service-connection controls. After successful sign-in, open Documents and omit the license screen from signed-in navigation. The public customer QR upload remains account-free in the browser.

**Why:** the user explicitly corrected that authentication must be the Windows app’s entry gate, not merely an API protection layer or a page inside the already-open workspace.

**How to apply:** Validate the license server-side before showing sign-up, and use its approved email for registration. Authorize shop management against the active license and device. Keep public customer uploads account-free, but bind every submitted request and file to the QR's shop and that individual request. Keep central approval and license controls in the browser admin portal; do not reintroduce third-party sign-in.

When a shop account created in the browser is first used by its Windows installation, allow the owner to explicitly move the account after password verification. Moving rebinds the license to the Windows device and revokes sessions on the previous device; it does not move local files.

**Why:** browser and installed-app device IDs differ, but the product still requires one active licensed installation per shop.

**How to apply:** Never silently rebind a shop. Explain that the previous installation will be signed out and local files remain on that device, then require explicit confirmation.

The shop Dashboard overview and QR Uploads queue are separate pages shared by the browser website and Windows app. The Dashboard summarizes the license-owned shop and request activity; QR Uploads keeps the permanent QR controls and individual customer requests. Both clients must use the same shop data, and browser sessions must not change the license's active Windows installation.

**Why:** the user asked for a separate Dashboard overview and QR Uploads queue, with matching shop features on the website and Windows app.

**How to apply:** Reuse the same shop data and APIs in both clients. Keep overview metrics separate from the QR Uploads queue. Allow browser authentication through its secure session cookie while keeping desktop device transfers explicit and browser logins non-rebinding.

After the shop profile is created, keep the owner view focused on incoming customer uploads: hide the profile editor and "Shop portal" heading, subtitle, license badge, and permanent QR card. Provide a "Show shop QR" button that opens the QR in a popup with print and copy-link actions. Show each file's analyzed page count and a starting estimate based on page count × copies × the saved B&W/colour rate; the shop owner still controls the final quote.

**Why:** the user wants the dashboard to show customer uploads and their cost after one-time shop setup.

**How to apply:** Render profile setup only when no profile exists, use the same rate formula as the customer upload estimate, and label the result as an estimate separate from the final quote.

Keep the public QR upload page minimal: do not show the shop name, address, or open/closed status in its form header, and do not ask customers for a phone number.

**Why:** the user wants the customer upload flow to be simple and straightforward.

**How to apply:** Keep the public form centered on file upload, print options, customer name, optional notes, estimated cost, and submission.

For new QR requests, use the per-page rates configured while creating the shop profile to calculate the customer price from analyzed pages and copies before submission. Save that amount as the request’s price immediately; the customer accepts it on the tracking page, and the shop should not re-enter it as a separate quote. Keep a one-time manual price path only for legacy requests received before automatic pricing. Clearly disclose that optional finishing charges are separate because they are not part of the configured page rates.

**Why:** the user wants to set pricing during QR setup and have the total calculated automatically instead of displaying a second estimate that the shop must copy after submission.

**How to apply:** Compute and persist the amount on the server when creating the request, using the rate snapshot at submission so later profile changes do not alter existing jobs. Show the same calculation before customer submission and on the tracking page.
