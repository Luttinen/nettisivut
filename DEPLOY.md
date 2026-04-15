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

## Notes
- Local development still uses SQLite file `poker.db`.
- Production uses Postgres when `DATABASE_URL` is set.
- You can seed demo logins with:
  - `npm run seed:demo`
  - Accounts: `demo1`, `demo2`, `demo3` with password `demo123`
