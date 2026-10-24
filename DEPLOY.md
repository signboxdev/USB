# Deploy to Hostinger

The live site is the contents of `dist/` at the document root of unfamiliarsoundbyte.com. Uploading replaces whatever is currently published.

## Build

```bash
npm install
npm run validate
npm run build
```

`dist/` then contains only:

- `.htaccess`
- `index.html`
- `styles.css`
- `coverflow.js`
- `search.js`
- `search.json`
- `logo.gif`
- `favicon.ico`
- `favicon-32.png`
- `apple-touch-icon.png`
- `icon-512.png`
- `og-image.png`
- `site.webmanifest`
- `robots.txt`
- `sitemap.xml`

`search.json` is the public search index (id, title, artist, album, who posted). A crate past 64 entries also writes `entries.json` at the root, and `p/<slug>/entries.json` for a poster page past that size. Those files are the public fields the page windows through. They do not include notes, match status, phone numbers, emails, or `posters.json`.

`index.html`, `.htaccess`, `robots.txt`, `sitemap.xml`, and the icon files have to sit at the site root, not inside a `dist` folder. Do not upload `data/catalog.json`. `.htaccess` sends `Cache-Control: no-cache` for HTML so a deploy is not stuck behind Safari's heuristic cache, and a long cache for the fingerprinted css, js, and gif files. It does not change the host's HTTPS redirect.

## hPanel

1. Websites → unfamiliarsoundbyte.com → File Manager.
2. Open `public_html`.
3. Upload every file from `dist/`.
4. If an old page sticks, clear the website cache in hPanel and reload.

## Zip deploy

From inside `dist`, so the archive root is `index.html`:

```bash
cd dist && zip -r ../site.zip .
```

On Shared or Cloud hosting, that zip is the static-site archive (`index.html` at the top, not `dist/index.html`). Deploying it overwrites the site.

## Check

- The homepage shows the crate, including title, artist, album, who posted, the date (no time-zone label), and a store link for each URL the entry has.
- A missing store link is omitted. The page does not print matched or unmatched.
- `https://unfamiliarsoundbyte.com/robots.txt` allows all crawlers and includes `Sitemap: https://unfamiliarsoundbyte.com/sitemap.xml`.
- `https://unfamiliarsoundbyte.com/sitemap.xml` lists `https://unfamiliarsoundbyte.com/`.
- View source has the title Unfamiliar Sound Byte, the description “Unfamiliar Sound Byte, the revolutionary group chat for music”, a canonical link to `https://unfamiliarsoundbyte.com/`, and Open Graph and Twitter card tags. There is no `noindex` meta.
- The only `og:image` and the `twitter:image` are `https://unfamiliarsoundbyte.com/og-image.png`, with width 1200, height 630, and `twitter:card` set to `summary_large_image`.

## GitHub auto-deploy (Premium, static)

A push to `main` runs `.github/workflows/deploy.yml`. It runs `npm run validate` and `npm run build`, then force-publishes the contents of `dist/` to the root of the `deploy` branch:

- `.htaccess`
- `index.html`
- `styles.css`
- `coverflow.js`
- `search.js`
- `search.json`
- `logo.gif`
- `favicon.ico`
- `favicon-32.png`
- `apple-touch-icon.png`
- `icon-512.png`
- `og-image.png`
- `site.webmanifest`
- `robots.txt`
- `sitemap.xml`
- `entries.json` when the crate is past 64 entries, plus `p/<slug>/entries.json` for a poster page of that size

Hostinger watches `deploy` and copies that branch into the site. It does not run the build. `data/catalog.json` stays off the server because `deploy` contains only those built files.

In hPanel: Websites → unfamiliarsoundbyte.com → Advanced → Git.

- Repository: `https://github.com/signboxdev/USB.git`
- Branch: `deploy`
- Install directory: leave this empty. The files then land in `public_html`, and the install directory has to be empty before the first deploy.
- Auto-deploy webhook: enabled.

A later push to `main` rebuilds `deploy`. The webhook tells Hostinger, and Hostinger replaces the files in `public_html`.

`.github/workflows/ci.yml` runs the same validate and build on every push and on pull requests. It does not publish.
