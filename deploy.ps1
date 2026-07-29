# Deployment Script for RACK Server
# Run this script in PowerShell to deploy the project directly to the RACK server.

$ErrorActionPreference = "Stop"

# Define Server Variables
$ServerIP = "122.176.147.78"
$SSHPort = "2222"
$SSHUser = "kapil"
$RemoteDir = "/home/deepanshu"
$ArchiveName = "project.tar.gz"

Write-Host "=== Starting Deployment to RACK Server ===" -ForegroundColor Cyan

# 1. Clean up local archive if it exists
if (Test-Path $ArchiveName) {
    Remove-Item $ArchiveName
}

# 2. Compress the project (excluding node_modules, dist, git, database, and
#    .env). The server's .env is maintained BY HAND directly on the server
#    (real CORS origin, SMTP/WhatsApp secrets, etc.) — shipping the local
#    .env would silently clobber that with this machine's dev-local values
#    (localhost CORS origin, dev credentials) on every redeploy. .env.example
#    is still included so a fresh server setup has the template to copy from.
Write-Host "1. Packaging project files (excluding node_modules, database, .env)..." -ForegroundColor Yellow
# *.sqlite-* catches SQLite's WAL-mode side files (app.sqlite-wal,
# app.sqlite-shm) — "*.sqlite" alone does NOT match these (they don't end in
# literally ".sqlite"), so without this they'd ride along into the archive.
# That's not just clutter: a -wal file holds uncommitted writes belonging to
# THIS machine's database. Landing it next to the SERVER's own app.sqlite
# (which never gets overwritten, its main file is excluded too) risks SQLite
# trying to replay a WAL against a main file it doesn't correspond to on next
# open — real corruption risk, not hypothetical.
tar --exclude="node_modules" --exclude="dist" --exclude=".git" --exclude="*.sqlite" --exclude="*.sqlite-*" --exclude=".env" -czf $ArchiveName backend frontend README.md ROADMAP.md RM_DC_Contacts_TEMPLATE.xlsx template.md

# 3. Upload archive to RACK server
Write-Host "2. Uploading archive to RACK server (${ServerIP}:${SSHPort})..." -ForegroundColor Yellow
scp -P $SSHPort $ArchiveName "${SSHUser}@${ServerIP}:${RemoteDir}/"

# 4. Extract, install, BUILD, and restart — all in ONE ssh call so the server
#    only prompts for the password once.
#
#    Why the builds matter (this used to be the bug that made deploys look
#    like they did nothing): the archive deliberately excludes `dist/`, and
#    the server serves `frontend/dist`. Uploading new SOURCE without
#    rebuilding leaves the OLD dist in place, so the dashboard keeps showing
#    the previous version. Likewise the backend runs compiled `dist/src/
#    server.js` (see package.json "start"), and a running Node process does
#    not pick up changed files on its own — it has to be rebuilt AND
#    restarted.
Write-Host "3. Extracting, installing, building and restarting on RACK server..." -ForegroundColor Yellow

# Restart step is deliberately conservative: this may be a shared server, so
# it never blindly runs `pm2 restart all` (that would bounce unrelated apps).
# It restarts only pm2 processes whose name looks like this project, and if it
# can't identify one unambiguously it prints what's running and asks for a
# manual restart rather than guessing.
$RemoteScript = @'
set -e
cd /home/deepanshu
tar -xzf project.tar.gz
rm project.tar.gz

echo "--- backend: install + compile ---"
cd backend
npm install
npm run build

echo "--- frontend: install + build ---"
cd ../frontend
npm install
npm run build

echo "--- restart ---"
if command -v pm2 >/dev/null 2>&1; then
  MATCHES=$(pm2 jlist 2>/dev/null | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"//' | grep -iE 'eyes|inactiv|eko' || true)
  COUNT=$(echo "$MATCHES" | grep -c . || true)
  if [ "$COUNT" = "1" ]; then
    echo "Restarting pm2 process: $MATCHES"
    pm2 restart "$MATCHES" --update-env
    pm2 save || true
  else
    echo "!! Could not identify a single matching pm2 process (found: $COUNT)."
    echo "!! Currently running under pm2:"
    pm2 list || true
    echo "!! Build IS updated. Restart the right process manually, e.g.:  pm2 restart <name>"
  fi
else
  echo "!! pm2 not found. Build IS updated, but the backend process was NOT restarted."
  echo "!! Restart it however this server runs it (systemctl / screen / npm start)."
fi
'@

# Pass the script over stdin so quoting stays sane between PowerShell and bash.
$RemoteScript | ssh -p $SSHPort "${SSHUser}@${ServerIP}" "bash -s"

# 5. Clean up local archive
if (Test-Path $ArchiveName) {
    Remove-Item $ArchiveName
}

Write-Host "=== Deployment Completed! ===" -ForegroundColor Green
Write-Host "Check the output above: if it says the process was NOT restarted, do that manually." -ForegroundColor Yellow
