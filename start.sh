#!/usr/bin/env bash
# =====================================================================
# VoteLive — environment check and launcher
#
#   ./start.sh            check the environment, prepare it, start the app
#   ./start.sh --check    only check the environment (changes nothing)
#   ./start.sh --seed     also load the demo accounts and polls
#
# Windows: run it from Git Bash (installed with Git for Windows) or WSL,
# with Docker Desktop started.
# =====================================================================
set -uo pipefail

REQUIRED_NODE_MAJOR=20
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER="votelive-postgres"

CHECK_ONLY=false
SEED=false
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=true ;;
    --seed) SEED=true ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (use --help)"; exit 1 ;;
  esac
done

# ---------- output helpers ----------
if [ -t 1 ]; then G=$'\e[32m'; R=$'\e[31m'; Y=$'\e[33m'; B=$'\e[1m'; N=$'\e[0m'; else G=""; R=""; Y=""; B=""; N=""; fi
ok()   { echo "  ${G}✔${N} $*"; }
warn() { echo "  ${Y}!${N} $*"; }
fail() { echo "  ${R}✘${N} $*"; ERRORS=$((ERRORS + 1)); }
step() { echo; echo "${B}$*${N}"; }
ERRORS=0

# ---------- platform ----------
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  Darwin*) PLATFORM="macos" ;;
  *) PLATFORM="linux" ;;
esac
if [ "$PLATFORM" = "linux" ] && grep -qi microsoft /proc/version 2>/dev/null; then PLATFORM="wsl"; fi

step "1. Platform"
ok "Detected: $PLATFORM"

# Windows checkouts often convert LF to CRLF, which breaks bash scripts.
if grep -q $'\r' "$0" 2>/dev/null; then
  fail "This script has Windows line endings (CRLF). Fix with: git config core.autocrlf input && git checkout -- start.sh"
fi

# ---------- Node.js ----------
step "2. Node.js (>= $REQUIRED_NODE_MAJOR required)"
if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null)"
  NODE_MAJOR="${NODE_VERSION%%.*}"
  if [ -n "$NODE_MAJOR" ] && [ "$NODE_MAJOR" -ge "$REQUIRED_NODE_MAJOR" ] 2>/dev/null; then
    ok "Node.js v$NODE_VERSION"
  else
    fail "Node.js v$NODE_VERSION is too old. Install the LTS version from https://nodejs.org (Windows: the .msi installer, then reopen Git Bash)."
  fi
else
  fail "Node.js is not installed. Install the LTS version from https://nodejs.org, then reopen the terminal."
fi
if command -v npm >/dev/null 2>&1; then
  ok "npm v$(npm -v 2>/dev/null)"
else
  fail "npm is not available (it is installed together with Node.js)."
fi

# ---------- Docker ----------
step "3. Docker"
COMPOSE=""
if command -v docker >/dev/null 2>&1; then
  ok "Docker CLI: $(docker --version 2>/dev/null | sed 's/Docker version //')"
  if docker info >/dev/null 2>&1; then
    ok "Docker engine is running"
  else
    if [ "$PLATFORM" = "windows" ] || [ "$PLATFORM" = "wsl" ]; then
      fail "Docker is installed but not running. Start Docker Desktop, wait until it says 'Engine running', then retry."
    else
      fail "Docker is installed but the engine is not running (try: sudo systemctl start docker)."
    fi
  fi
  if docker compose version >/dev/null 2>&1; then
    COMPOSE="docker compose"; ok "Docker Compose: $(docker compose version --short 2>/dev/null)"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE="docker-compose"; ok "Docker Compose (legacy docker-compose)"
  else
    fail "Docker Compose is missing (it is included in Docker Desktop)."
  fi
else
  if [ "$PLATFORM" = "windows" ] || [ "$PLATFORM" = "wsl" ]; then
    fail "Docker is not installed. Install Docker Desktop: https://www.docker.com/products/docker-desktop/ (enable the WSL 2 backend), then reopen the terminal."
  else
    fail "Docker is not installed: https://docs.docker.com/get-docker/"
  fi
fi

# ---------- Ports ----------
step "4. Ports"
# Uses Node to try to bind each port: works the same on Windows, macOS and Linux.
port_free() {
  node -e "const s=require('net').createServer();s.once('error',()=>process.exit(1));s.once('listening',()=>s.close(()=>process.exit(0)));s.listen($1,'0.0.0.0')" >/dev/null 2>&1
}
DB_RUNNING=false
if [ -n "$COMPOSE" ] && [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = "true" ]; then DB_RUNNING=true; fi
if command -v node >/dev/null 2>&1; then
  for entry in "3000:frontend (Next.js)" "5000:backend (Express)" "5432:PostgreSQL"; do
    port="${entry%%:*}"; name="${entry#*:}"
    if [ "$port" = "5432" ] && $DB_RUNNING; then ok "5432 is used by the VoteLive database container (expected)"; continue; fi
    if port_free "$port"; then
      ok "$port is free for the $name"
    else
      fail "Port $port ($name) is already in use. Stop the program using it$([ "$port" = 5432 ] && echo ' (often a local PostgreSQL service: on Windows, services.msc → stop "postgresql")')."
    fi
  done
fi

# ---------- Configuration files ----------
step "5. Configuration"
[ -f "$ROOT/backend/.env" ] && ok "backend/.env exists" || warn "backend/.env is missing (it will be created from .env.example)"
[ -f "$ROOT/frontend/.env.local" ] && ok "frontend/.env.local exists" || warn "frontend/.env.local is missing (it will be created from .env.local.example)"
if [ -f "$ROOT/backend/.env" ] && ! grep -qE '^OPENROUTER_API_KEY=.+' "$ROOT/backend/.env"; then
  warn "OPENROUTER_API_KEY is empty in backend/.env: the app works, but AI generation is disabled."
fi

echo
if [ "$ERRORS" -gt 0 ]; then
  echo "${R}${B}$ERRORS problem(s) found.${N} Fix them and run ./start.sh again."
  exit 1
fi
echo "${G}${B}Environment OK.${N}"
$CHECK_ONLY && exit 0

# =====================================================================
# Preparation
# =====================================================================
step "6. Preparing the project"

if [ ! -f "$ROOT/backend/.env" ]; then
  cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
  SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
  node -e "const f=process.argv[1],fs=require('fs');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/^JWT_SECRET=.*$/m,'JWT_SECRET='+process.argv[2]))" "$ROOT/backend/.env" "$SECRET"
  ok "Created backend/.env with a random JWT secret"
  warn "To enable AI generation, paste your key into OPENROUTER_API_KEY= in backend/.env"
fi
if [ ! -f "$ROOT/frontend/.env.local" ]; then
  cp "$ROOT/frontend/.env.local.example" "$ROOT/frontend/.env.local"
  ok "Created frontend/.env.local"
fi

for app in backend frontend; do
  if [ ! -d "$ROOT/$app/node_modules" ]; then
    echo "  Installing $app dependencies (first run, this can take a few minutes)…"
    (cd "$ROOT/$app" && npm install --no-fund --no-audit) || { fail "npm install failed in $app"; exit 1; }
    ok "$app dependencies installed"
  else
    ok "$app dependencies already installed"
  fi
done

step "7. Database"
(cd "$ROOT" && $COMPOSE up -d postgres) >/dev/null 2>&1 || { fail "Could not start the PostgreSQL container ($COMPOSE up -d postgres)."; exit 1; }
printf "  Waiting for PostgreSQL"
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null)" = "healthy" ] && break
  printf "."; sleep 1
done
echo
if [ "$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null)" != "healthy" ]; then
  fail "PostgreSQL did not become ready. See: docker logs $CONTAINER"; exit 1
fi
ok "PostgreSQL is ready"
(cd "$ROOT/backend" && npm run --silent migrate) || { fail "Database migration failed"; exit 1; }
ok "Database schema is up to date"
if $SEED; then
  (cd "$ROOT/backend" && npm run --silent seed) && ok "Demo data loaded (admin / alice / bob @votelive.local)"
fi

# =====================================================================
# Start
# =====================================================================
step "8. Starting VoteLive"

PIDS=()
# npm starts next/tsx as grandchildren, so the whole process tree must be stopped.
kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$child"; done
  kill "$1" 2>/dev/null
}
stop_all() {
  trap - INT TERM
  echo; echo "Stopping VoteLive…"
  for pid in "${PIDS[@]}"; do
    if [ "$PLATFORM" = "windows" ] && [ -r "/proc/$pid/winpid" ]; then
      # Windows: taskkill /T stops the whole tree (npm → node → next/tsx).
      taskkill //F //T //PID "$(cat "/proc/$pid/winpid")" >/dev/null 2>&1
    else
      kill_tree "$pid"
    fi
  done
  echo "Stopped. The database container keeps running (stop it with: $COMPOSE stop)."
  exit 0
}
trap stop_all INT TERM

(cd "$ROOT/backend" && npm run dev 2>&1 | sed -u "s/^/[backend]  /") &
PIDS+=($!)
(cd "$ROOT/frontend" && npm run dev 2>&1 | sed -u "s/^/[frontend] /") &
PIDS+=($!)

printf "  Waiting for the backend"
for _ in $(seq 1 60); do
  node -e "fetch('http://localhost:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 && break
  printf "."; sleep 1
done
echo
echo
echo "${G}${B}VoteLive is running${N}"
echo "  Application : http://localhost:3000"
echo "  API         : http://localhost:5000/api   (docs: http://localhost:5000/api/docs)"
$SEED && echo "  Demo login  : alice@votelive.local / Alice1234"
echo "  Press Ctrl+C to stop."
echo

wait
