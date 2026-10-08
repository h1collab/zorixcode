# Zorix Code

Production desktop client for Windows built with Electron.

## Security model

- The renderer has no Node.js access.
- Context isolation and Chromium sandbox are enabled.
- Zorix credentials are sent only through the main process to `https://zorix.it`.
- Authentication cookies are stored in Electron's persistent Zorix session and are never exposed to renderer JavaScript.
- The application requires a valid Zorix session before the workspace is available.
- External navigation is blocked except explicit Zorix links opened in the system browser.

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

The GitHub Actions workflow builds an x64 NSIS installer on Windows. If repository secrets `CSC_LINK` and `CSC_KEY_PASSWORD` are configured, the installer is code-signed automatically; otherwise the build is unsigned.
