# Deploy to Hostinger

The live site is the contents of `dist/` at the document root of unfamiliarsoundbyte.com. Uploading replaces whatever is currently published.

## Build

```bash
npm install
npm run validate
npm run build
```

`dist/` then contains only:

- `index.html`
- `styles.css`
- `logo.gif`
- `favicon.ico`
- `favicon-32.png`
- `apple-touch-icon.png`
- `icon-512.png`
- `og-image.png`
- `site.webmanifest`
- `robots.txt`
- `sitemap.xml`

`index.html`, `robots.txt`, `sitemap.xml`, and the icon files have to sit at the site root, not inside a `dist` folder. Do not upload `data/catalog.json`.

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

- The homepage shows the crate, including title, artist, album, who posted, the date, and both store chips.
- A missing store link reads **unmatched**.
- `https://unfamiliarsoundbyte.com/robots.txt` allows all crawlers and includes `Sitemap: https://unfamiliarsoundbyte.com/sitemap.xml`.
- `https://unfamiliarsoundbyte.com/sitemap.xml` lists `https://unfamiliarsoundbyte.com/`.
- View source has the title Unfamiliar Sound Byte, the description “Unfamiliar Sound Byte, the revolutionary group chat for music”, a canonical link to `https://unfamiliarsoundbyte.com/`, and Open Graph and Twitter card tags. There is no `noindex` meta.
- The only `og:image` and the `twitter:image` are `https://unfamiliarsoundbyte.com/og-image.png`, with width 1200, height 630, and `twitter:card` set to `summary_large_image`.

## GitHub auto-deploy (Premium, static)

A push to `main` runs `.github/workflows/deploy.yml`. It runs `npm run validate` and `npm run build`, then force-publishes the contents of `dist/` to the root of the `deploy` branch:

- `index.html`
- `styles.css`
- `logo.gif`
- `favicon.ico`
- `favicon-32.png`
- `apple-touch-icon.png`
- `icon-512.png`
- `og-image.png`
- `site.webmanifest`
- `robots.txt`
- `sitemap.xml`

Hostinger watches `deploy` and copies that branch into the site. It does not run the build. `data/catalog.json` stays off the server because `deploy` contains only those built files.

In hPanel: Websites → unfamiliarsoundbyte.com → Advanced → Git.

- Repository: `https://github.com/signboxdev/USB.git`
- Branch: `deploy`
- Install directory: leave this empty. The files then land in `public_html`, and the install directory has to be empty before the first deploy.
- Auto-deploy webhook: enabled.

A later push to `main` rebuilds `deploy`. The webhook tells Hostinger, and Hostinger replaces the files in `public_html`.

`.github/workflows/ci.yml` runs the same validate and build on every push and on pull requests. It does not publish.
