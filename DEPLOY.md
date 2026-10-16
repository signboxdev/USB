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
- `favicon.svg`
- `robots.txt`

`index.html` and `robots.txt` have to sit at the site root, not inside a `dist` folder. Do not upload `data/catalog.json`.

## hPanel

1. Websites → unfamiliarsoundbyte.com → File Manager.
2. Open `public_html`.
3. Upload the four files from `dist/`.
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
- `https://unfamiliarsoundbyte.com/robots.txt` is `Disallow: /`.
- View source contains `<meta name="robots" content="noindex,nofollow">`.
