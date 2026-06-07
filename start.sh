#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCK_FILE="$SCRIPT_DIR/.codeatlas.lock"
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

kill_project_processes() {
    local count=0
    for pid in $(ps aux | grep -E "(node|Electron|vite)" | grep -v grep | awk '{print $2}'); do
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

echo -e "${CYAN}[1/2] Cleanup...${NC}"
kill_project_processes
echo ""

# ── Start Electron (Express backend embedded) ──────

echo -e "${CYAN}[2/2] Starting CodeAtlas...${NC}"
cd "$FRONTEND_DIR"
unset ELECTRON_RUN_AS_NODE
npm run electron:dev &
FRONTEND_PID=$!

sleep 8
if curl -s http://localhost:19850/api/v1/health > /dev/null 2>&1; then
    echo -e "      ${GREEN}✓ Backend OK${NC} (Express embedded in Electron)"
else
    echo -e "      ${YELLOW}⚠ Starting... (check window)${NC}"
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
    kill $FRONTEND_PID 2>/dev/null || true
    lsof -ti:19850 2>/dev/null | xargs kill -9 2>/dev/null || true
    lsof -ti:5173 2>/dev/null | xargs kill -9 2>/dev/null || true
    rm -f "$LOCK_FILE"
    echo -e "${GREEN}Done.${NC}"
}
trap cleanup EXIT INT TERM

wait
