# Zorix Code

Production desktop client for Windows built with Electron.

## Authentication

Zorix Code does not collect or handle account credentials. On startup it checks the persistent Zorix session. If no valid session exists, the app opens the official `https://zorix.it/login` page in a dedicated Electron window that shares only the Zorix session partition. The workspace is unlocked only after Zorix reports an authenticated session.

## Security model

- Renderer JavaScript has no Node.js access.
- Context isolation and the Chromium sandbox are enabled.
- Zorix session cookies are stored in Electron's persistent session and are not exposed to renderer JavaScript.
- The main workspace cannot be used before a valid Zorix session exists.
- Main-window navigation is restricted to packaged local files.
- External links are limited to HTTPS Zorix domains.
- The source tree includes a build-time brand check that fails if legacy product names reappear.

## Development

```bash
npm install
npm start
```

## Windows build

```bash
npm install
npm run dist:win
```

GitHub Actions builds an x64 NSIS installer on `windows-latest`. If repository secrets `CSC_LINK` and `CSC_KEY_PASSWORD` are configured, the installer is code-signed; otherwise the build remains unsigned.

The workflow artifact is named `Zorix-Code-Windows-x64`.
