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
- `sitemap.xml`

`index.html`, `robots.txt`, and `sitemap.xml` have to sit at the site root, not inside a `dist` folder. Do not upload `data/catalog.json`.

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

## GitHub auto-deploy (Premium, static)

Premium hosting can pull [signboxdev/USB](https://github.com/signboxdev/USB) and replace the live files on every push. In hPanel: Websites → unfamiliarsoundbyte.com → Advanced → Git → Connect with GitHub. Install the Hostinger GitHub App and grant it this repository.

That deploy copies one branch into a directory on the server (the site root, `public_html`, unless you change it) and serves those files. It does not run `npm install` or `npm run build`. Whatever is committed on the branch is what the site serves, so `index.html` has to be at the root of the branch Hostinger watches. `data/catalog.json` should not be in that tree.

`.github/workflows/ci.yml` runs `npm run validate` and `npm run build` on every push and on pull requests. A bad catalog fails there. The workflow does not publish the site.

### Build onto a deploy branch

Leave `main` as the source. `dist/` stays gitignored. After a green build, publish the files inside `dist/` as the root of a `deploy` branch, and point Hostinger at that branch.

```bash
npm ci
npm run validate
npm run build
rm -rf /tmp/usb-deploy
mkdir /tmp/usb-deploy
cp dist/index.html dist/styles.css dist/favicon.svg dist/robots.txt dist/sitemap.xml /tmp/usb-deploy/
git -C /tmp/usb-deploy init -b deploy
git -C /tmp/usb-deploy add index.html styles.css favicon.svg robots.txt sitemap.xml
git -C /tmp/usb-deploy commit -m "Publish dist"
git -C /tmp/usb-deploy remote add origin https://github.com/signboxdev/USB.git
git -C /tmp/usb-deploy push --force origin deploy
```

In hPanel set:

- Repository: `signboxdev/USB`
- Branch: `deploy`
- Deploy directory: `public_html`
- Auto-deployment: on

A push to `deploy` replaces those files at the site root. A push to `main` updates the catalog source and runs the check. Publish `deploy` again when that change should go live. The branch holds only the built page, including `sitemap.xml`, so `data/catalog.json` never lands on the server.

### Commit the build output

Premium will not run the build, so the branch Hostinger watches has to already contain the page. To keep a single branch:

1. Remove the `dist/` line from `.gitignore`.
2. Run `npm run validate` and `npm run build`.
3. Copy `index.html`, `styles.css`, `favicon.svg`, `robots.txt`, and `sitemap.xml` from `dist/` to the repository root and commit them on the branch Hostinger watches.
4. In hPanel, connect that branch (`main`, if that is the one you push) and set the deploy directory to `public_html`. Auto-deployment stays on.

Hostinger copies the whole branch into `public_html`. With those files at the root, the homepage is `index.html` and the sitemap is `sitemap.xml`. The same copy also includes `data/catalog.json`. The `deploy` branch above contains only the built files, so the catalog stays off the server.

Committing the `dist/` directory and leaving the files inside it puts the page at `dist/index.html`. Copy them to the branch root before Hostinger pulls.
