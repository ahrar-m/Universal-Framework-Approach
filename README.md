# Universal Framework Approach

Source repository for the **Universal Framework Approach**.

## Live site

Published with GitHub Pages: <https://ahrar-m.github.io/Universal-Framework-Approach/>

## Repository layout

| Path | Purpose |
| --- | --- |
| `docs/` | Static site served by GitHub Pages; `docs/index.html` is the entry point |
| `.github/workflows/pages.yml` | Deploys `docs/` to GitHub Pages on every push to `main` |
| `README.md` | This file |

## Local development

The site is plain HTML/CSS with no build step. Edit the files in `docs/`, then:

```bash
git add -A
git commit -m "Update site"
git push
```

To preview locally, serve the folder over HTTP:

```bash
python3 -m http.server 8000 --directory docs
```

Then open <http://localhost:8000/>.
