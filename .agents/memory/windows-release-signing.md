---
name: Windows release signing
description: Smart App Control behavior and Windows packaging constraints for this project.
---

Do not distribute unsigned Windows executables. Windows Smart App Control can block them; an Authenticode signature from a trusted code-signing provider is the appropriate release path. Build configuration should fail rather than silently produce unsigned release binaries.

An explicitly named unsigned test build is acceptable only for isolated QA. Keep its configuration and output separate from release builds, never distribute it to customers, and test it in a disposable Windows VM rather than weakening protection on the user's everyday PC. Smart App Control will still block it on an enforcing machine.

Electron loads the packaged renderer with `file://`, so desktop Vite builds must emit relative asset URLs. An absolute `/assets/...` base resolves against the drive root and opens a blank window.

**Why:** the user’s Windows PC blocked the unsigned portable build, then explicitly needed a temporary test build before Store publication. The Replit Linux runner's Wine setup can package a portable executable but cannot run the NSIS installer tooling reliably.

**How to apply:** use a relative Vite base for every Electron build while keeping the web build's configured artifact base. Provide a trusted Windows signing certificate to electron-builder through secure signing environment variables for release builds. Use a Windows runner or verified compatible Wine toolchain for NSIS installers. Do not advise bypassing Smart App Control or shipping the unsigned test file as a fix.
