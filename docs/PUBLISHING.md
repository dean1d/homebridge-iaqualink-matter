# Publishing to GitHub and npm

## GitHub

1. Create an empty public repository named `homebridge-iAqualink-Matter`.
2. Replace every `YOUR_GITHUB_USERNAME` value in `package.json`.
3. In VS Code terminal:

```bash
git init
git add .
git commit -m "Initial Homebridge iAquaLink scaffold"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/homebridge-iAqualink-Matter.git
git push -u origin main
```

## npm preparation

1. Confirm the package name is available: `npm view homebridge-iaqualink-matter`.
2. Sign in: `npm login`.
3. Remove `"private": true` from `package.json` only when ready.
4. Run `npm run check`.
5. Test package contents with `npm pack --dry-run`.
6. Publish a preview first: `npm publish --tag beta --access public`.

## Automated releases

Create an npm granular access token and save it in the GitHub repository secret `NPM_TOKEN`. The included release workflow publishes when a GitHub Release is published.

## Release checklist

- Cloud adapter completed and tested
- Credentials and diagnostics redacted
- Homebridge 2 HAP and Matter tested
- Child-bridge install tested
- Upgrade/uninstall tested
- CHANGELOG updated
- Version bumped with SemVer
- `npm run check` passes
- `npm pack --dry-run` contains only intended files
