# Deploy Online (Railway)

## 1) Push project to GitHub (required files)
- Commit **`package.json`**, **`package-lock.json`**, and **`Dockerfile`** together and push.
- If `package-lock.json` is missing on GitHub, the Docker build (and any `npm ci`) **will fail**.

## 2) Create a Railway project
- In Railway, create a new project from your GitHub repo.
- This repo includes a **`Dockerfile`** at the root: Railway will **build with Docker** (not Railpack/Nixpacks), run `npm ci --omit=dev` in Linux, then `npm start` → `node server.js`.

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

## Troubleshooting
- **Build fails at `npm ci`** — run `npm install` locally, commit the updated `package-lock.json`, push, redeploy.
- **Do not commit `node_modules`** — use the included `.gitignore`. If `node_modules` was committed before, remove it from git: `git rm -r --cached node_modules` then commit (keeps your local folder if present).
- **`npm warn config production`** — harmless leftover npm setting; optional: `npm config delete production`.

## Notes
- Local development still uses SQLite file `poker.db`.
- Production uses Postgres when `DATABASE_URL` is set.
- You can seed demo logins with:
  - `npm run seed:demo`
  - Accounts: `demo1`, `demo2`, `demo3` with password `demo123`
