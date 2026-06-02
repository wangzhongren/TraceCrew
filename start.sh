#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCK_FILE="$SCRIPT_DIR/.codeatlas.lock"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}╔══════════════════════════════════╗${NC}"
echo -e "${CYAN}║       CodeAtlas Launcher         ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════╝${NC}"
echo ""

# ── Singleton: check lock file ────────────────────

if [ -f "$LOCK_FILE" ]; then
    old_pid=$(cat "$LOCK_FILE" 2>/dev/null)
    if kill -0 "$old_pid" 2>/dev/null; then
        echo -e "  ${YELLOW}[!] Another launcher is running (PID $old_pid)${NC}"
        echo -e "  ${YELLOW}[!] Cleaning up previous instance...${NC}"
        kill -9 "$old_pid" 2>/dev/null || true
        sleep 1
    fi
    rm -f "$LOCK_FILE"
fi
echo $$ > "$LOCK_FILE"

# ── Kill all related processes ─────────────────────

kill_port() {
    local port=$1
    local name=$2
    local pids=$(lsof -ti:$port 2>/dev/null)
    if [ -n "$pids" ]; then
        echo -e "  ${YELLOW}[!] Port $port ($name) occupied${NC}"
        for pid in $pids; do
            local proc_name=$(ps -p $pid -o comm= 2>/dev/null || echo "unknown")
            echo -e "      └─ PID $pid ($proc_name) → kill -9"
            kill -9 $pid 2>/dev/null || true
        done
        sleep 1
        if [ -z "$(lsof -ti:$port 2>/dev/null)" ]; then
            echo -e "      ${GREEN}✓ Freed${NC}"
        else
            echo -e "      ${RED}✗ Still occupied${NC}"
            return 1
        fi
    else
        echo -e "  ${GREEN}✓ Port $port ($name) free${NC}"
    fi
}

# Kill all node/python/electron processes under this project
kill_project_processes() {
    local count=0
    # Find processes whose cwd or command line references this project
    for pid in $(ps aux | grep -E "(node|python|Electron|uvicorn|vite)" | grep -v grep | awk '{print $2}'); do
        local cmd=$(ps -p $pid -o command= 2>/dev/null || "")
        if echo "$cmd" | grep -q "$SCRIPT_DIR"; then
            count=$((count + 1))
            kill -9 $pid 2>/dev/null || true
        fi
    done
    if [ $count -gt 0 ]; then
        echo -e "  ${YELLOW}[!] Killed $count project-related process(es)${NC}"
    fi
}

echo -e "${CYAN}[1/4] Singleton check & cleanup...${NC}"
kill_project_processes
kill_port 19850 "Backend"
kill_port 5173 "Frontend"
echo ""

# ── Start Backend ──────────────────────────────────

echo -e "${CYAN}[2/4] Starting backend (port 19850)...${NC}"
cd "$BACKEND_DIR"
.venv312/bin/python -m uvicorn main:app --port 19850 &
BACKEND_PID=$!
sleep 2

if curl -s http://localhost:19850/api/v1/health > /dev/null 2>&1; then
    echo -e "      ${GREEN}✓ Backend OK${NC} (pid: $BACKEND_PID)"
else
    echo -e "      ${RED}✗ Backend failed${NC}"
    rm -f "$LOCK_FILE"
    exit 1
fi
echo ""

# ── Start Frontend ─────────────────────────────────

echo -e "${CYAN}[3/4] Starting Electron...${NC}"
cd "$FRONTEND_DIR"
unset ELECTRON_RUN_AS_NODE
npm run electron:dev &
FRONTEND_PID=$!

sleep 8
if curl -s -o /dev/null -w "%{http_code}" http://localhost:5173 2>/dev/null | grep -q 200; then
    echo -e "      ${GREEN}✓ Frontend OK${NC} (pid: $FRONTEND_PID)"
else
    echo -e "      ${YELLOW}⚠ Frontend starting... (check window)${NC}"
fi
echo ""

# ── Done ───────────────────────────────────────────

echo -e "${GREEN}╔══════════════════════════════════╗${NC}"
echo -e "${GREEN}║       All systems ready          ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Backend : http://localhost:19850${NC}"
echo -e "${GREEN}║  Frontend: http://localhost:5173 ${NC}"
echo -e "${GREEN}╚══════════════════════════════════╝${NC}"
echo ""
echo -e "Press ${RED}Ctrl+C${NC} to stop all"

# ── Cleanup ────────────────────────────────────────

cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down...${NC}"
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    lsof -ti:19850 2>/dev/null | xargs kill -9 2>/dev/null || true
    lsof -ti:5173 2>/dev/null | xargs kill -9 2>/dev/null || true
    rm -f "$LOCK_FILE"
    echo -e "${GREEN}Done.${NC}"
}
trap cleanup EXIT INT TERM

wait
