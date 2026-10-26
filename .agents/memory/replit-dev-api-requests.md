---
name: Replit dev API requests from Electron
description: Required request header when the desktop file-origin client calls APIs on a Replit development URL.
---

When the Electron client sends requests from its `file://` origin to a Replit `.replit.dev` URL, adding `X-Requested-With: XMLHttpRequest` may pass one gateway check, but it is not sufficient authorization. Development URLs are protected; an external desktop client needs a supported Replit External Access Token or must use a published service URL.

**Why:** a Windows app request to the development URL first returned `Expected X-Requested-With header`, then `Expected referrer, referer, or origin header`; the latter confirms the gateway is protecting external traffic, not that the API endpoint is broken.

**How to apply:** Do not spoof browser `Origin` or `Referer` headers. Use the development URL only for same-origin browser preview requests, or configure Replit's supported external access for a desktop test client. Use the published service URL for production installations.
