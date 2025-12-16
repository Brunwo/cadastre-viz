Use actions like this in .github/workflows/deploy.yml for CI/CD:

name: Deploy
on: [push]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: actions/configure-pages@v5
    - uses: actions/upload-pages-artifact@v3
      with: { path: '.' }
    - uses: actions/deploy-pages@v4



GH CLI Method

Install gh CLI, authenticate with gh auth login. Enable Pages via API: gh api repos/{owner}/{repo}/pages -X PUT -f source_path="/" -f source_branch="main".

​

Deploy branch: git checkout -b gh-pages; git push origin gh-pages. No native gh pages command exists yet, but this scripts it.
​