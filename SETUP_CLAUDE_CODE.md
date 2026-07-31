# Moving to Claude Code

## 1. Make it a git repo

```bash
cd ~/Downloads/blkops-crm
git init
git add .
git commit -m "Black Ops CRM: schema, app, importer"
```

`import-data/` and `.env` are gitignored — your CSVs and keys stay off GitHub.

## 2. Push to GitHub

Create an empty repo at github.com/new called `blkops-crm`. Do not add a README
or .gitignore. Then:

```bash
git remote add origin https://github.com/brenlamar88/blkops-crm.git
git branch -M main
git push -u origin main
```

## 3. Open in Claude Code

```bash
cd ~/Downloads/blkops-crm
claude
```

It reads `CLAUDE.md` automatically — that file carries the schema decisions,
which Gravity Forms are live versus dead, and the import gotchas, so you are
not starting from nothing.

## 4. Keep your keys out of the repo

Claude Code inherits your shell, so export them in the terminal before starting:

```bash
export SUPABASE_URL=https://hhycqqtwhdofwbxmnbsr.supabase.co
export SUPABASE_SERVICE_KEY=...
```

Or put them in `.env` — already gitignored.

## What to hand it first

The import is unfinished. A reasonable opening instruction:

> Read CLAUDE.md. Activities and referrals for Lake Charles still need to
> import — run `node scripts/import.mjs --campus lakecharles` and fix whatever
> it reports. The needs-*.csv exports are missing; help me get those out of
> Gravity Forms.

Before any schema change, have it run `./scripts/verify.sh`.
