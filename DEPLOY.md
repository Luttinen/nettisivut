# Deploy Online (Railway)

## 1) Push project to GitHub
- Commit your project and push to a GitHub repository.

## 2) Create a Railway project
- In Railway, create a new project from your GitHub repo.
- Railway will run `npm install` and `npm start`.

## 3) Add Postgres service
- In Railway project, add a PostgreSQL database.
- Railway will provide `DATABASE_URL` automatically for the app.

## 4) Environment variables
- Set `NODE_ENV=production`.
- **`DATABASE_URL` is required** in production: add PostgreSQL in Railway and link it so this variable is set (SQLite is for local dev only).

## 5) Open app
- Use deployed URL:
  - `/holdem.html` for poker
  - `/index.html` for blackjack
  - `/health` for healthcheck

## Troubleshooting (npm / Railpack)
- **`npm ci` fails in the build** — usually `package.json` and `package-lock.json` are out of sync or the lockfile was not pushed. Run `npm install` locally, commit **both** files, and redeploy.
- **Railpack** (build log mentions `mise`): add a **build** variable `RAILPACK_INSTALL_CMD` = `npm install --omit=dev --no-audit --no-fund` so the install step does not rely on strict `npm ci` if the lockfile still disagrees with the image.
- **`npm warn config production`** — harmless; something sets the old `production` npm flag. Prefer `omit=dev` in CI; you can run `npm config delete production` on your machine to silence it.

## Notes
- Local development still uses SQLite file `poker.db`.
- Production uses Postgres when `DATABASE_URL` is set.
- You can seed demo logins with:
  - `npm run seed:demo`
  - Accounts: `demo1`, `demo2`, `demo3` with password `demo123`
