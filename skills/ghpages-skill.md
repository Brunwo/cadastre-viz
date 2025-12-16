# GitHub Pages Setup Guide

This guide covers setting up GitHub Pages for modern web projects using GitHub Actions CI/CD pipeline.

## Prerequisites

- GitHub repository with your web project
- GitHub CLI (`gh`) installed and authenticated (`gh auth login`)
- Project should have a build script (e.g., `npm run build`, `yarn build`)

## Method 1: GitHub Actions CI/CD (Recommended)

### 1. Create GitHub Actions Workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  push:
    branches: [ main ]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci --legacy-peer-deps

      - name: Build
        run: npm run build

      - name: Setup Pages
        uses: actions/configure-pages@v5
        with:
          enablement: true

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: './dist'

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

### 2. Configure Build Tool for GitHub Pages

#### For Vite Projects

Update `vite.config.ts`:

```typescript
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      base: '/your-repo-name/', // IMPORTANT: Replace with your repo name
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      // ... rest of your config
    };
});
```

#### For Create React App

Add `homepage` field to `package.json`:

```json
{
  "name": "your-app",
  "homepage": "https://your-username.github.io/your-repo-name",
  // ... rest of package.json
}
```

### 3. Enable GitHub Pages via API

```bash
# Enable Pages with GitHub Actions workflow
gh api repos/{owner}/{repo}/pages -X POST -f source.branch="main" -f source.path="/" -f build_type="workflow"
```

### 4. Push Changes

```bash
git add .
git commit -m "Setup GitHub Pages deployment"
git push origin main
```

## Method 2: Manual Branch Deployment (Legacy)

### Create and Deploy gh-pages Branch

```bash
# Build your project
npm run build

# Create and switch to gh-pages branch
git checkout -b gh-pages

# Remove all files except dist
git rm -rf .
git commit -m "Remove existing files"

# Copy dist contents and commit
cp -r dist/* .
git add .
git commit -m "Deploy to GitHub Pages"

# Push to GitHub
git push origin gh-pages

# Switch back to main
git checkout main
```

### Enable Pages for Branch

```bash
# Enable Pages via API for gh-pages branch
gh api repos/{owner}/{repo}/pages -X PUT -f source_path="/" -f source_branch="gh-pages"
```

## Troubleshooting

### Dependency Conflicts (React 19)

If you encounter peer dependency issues:

```bash
# Use legacy peer deps flag
npm install --legacy-peer-deps
npm run build
```

Update workflow to use:
```yaml
- name: Install dependencies
  run: npm ci --legacy-peer-deps
```

### Workflow Permissions Error

If you see "Get Pages site failed" error, add `enablement: true` to the configure-pages action:

```yaml
- name: Setup Pages
  uses: actions/configure-pages@v5
  with:
    enablement: true
```

### Missing package-lock.json

GitHub Actions requires a lock file for caching. Generate one:

```bash
npm install  # Creates package-lock.json
git add package-lock.json
git commit -m "Add package-lock.json"
```

### Custom Domain

To use a custom domain:

```bash
# Via API
gh api repos/{owner}/{repo}/pages -X PUT -f cname="yourdomain.com"
```

Or create `CNAME` file in your repository root.

## Verification

### Check Deployment Status

```bash
# View Pages info
gh api repos/{owner}/{repo}/pages

# Check workflow runs
gh run list --workflow=Deploy

# View specific run
gh run view <run-id>
```

### Access Your Site

Your site will be available at: `https://your-username.github.io/your-repo-name/`

### Common Issues

1. **404 Errors**: Check if `base` path is correctly set in build config
2. **Build Failures**: Ensure build script exists and works locally
3. **Permission Errors**: Verify repository has Pages enabled
4. **Asset Loading Issues**: Check that all assets use relative paths

## Advanced Configuration

### Environment Variables

For projects needing environment variables:

```yaml
- name: Build
  run: |
    echo "VITE_API_URL=https://api.example.com" >> $GITHUB_ENV
    npm run build
  env:
    NODE_ENV: production
```

### Multiple Environments

```yaml
on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]
```

### Custom Build Commands

```yaml
- name: Build
  run: |
    npm run lint
    npm run test
    npm run build
```

This setup provides automatic deployment on every push to main branch, with proper error handling and dependency management.
