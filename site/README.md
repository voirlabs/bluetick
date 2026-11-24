# Landing page

The static site for https://bluetick.voirlabs.io, styled to match voirlabs.io. There's no build step and no dependencies.

- Preview: open `index.html` in a browser, or run `firebase serve --only hosting` from this folder.
- Deploy: it's served by Firebase Hosting as site `bluetick-voirlabs` in the Voir Labs open-source Firebase project (`open-source-65128`) (`firebase.json`, `.firebaserc`). Pushes to `main` that touch `site/` deploy it through `.github/workflows/site.yml`. To deploy by hand, run `firebase deploy --only hosting` from this folder.
- Logo and icons: `assets/logo.svg` and `favicon.svg` are the Bluetick mark, copied unchanged. `favicon-32.png` and `apple-touch-icon.png` are renderings of it.
- Social image: `og.png` is rendered from `scripts/og-image.html` with headless Chrome; the command is at the top of that file.
- SEO: the JSON-LD `@graph` in `index.html` links the product to the Voir Labs organization (`https://www.voirlabs.io/#organization`). Keep `robots.txt`, `sitemap.xml` and `llms.txt` in step with the page.
- Shared styles: `styles.css` is shared with the other Voir Labs open-source projects, so keep changes generic. Page-specific CSS goes in the `<style>` block of `index.html`.

`assets/logo.svg` (the Bluetick mark, also `favicon.svg`, `favicon-32.png` and `apple-touch-icon.png`), `assets/voir-mark.svg` and the hero art `assets/hero.webp` are Voir Labs brand assets. They are not covered by this repository's MIT license and may not be reused outside this project.
