import asyncio
import json
import logging
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

from fastapi import FastAPI, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse

from models.event import AgentRequest
from services.analyzer import topology_analyzer
from services.agent import agent_service
from services.sse_manager import sse_manager
from services.feature_analyzer import feature_analyzer
from services.feature_persistence import load, find_node
from services.db import upsert_feature, update_feature_children
from services.change_summarizer import change_summarizer
from services.change_queue import change_queue
from services.map_search import search_project_map
from models.feature import AnalyzeFeaturesRequest

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("codeatlas")

app = FastAPI(title="CodeAtlas Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.is_dir():
    app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")


# ── Agent Chat (non-streaming, kept for compatibility) ──

@app.post("/api/v1/agent/chat")
async def agent_chat(req: AgentRequest, background_tasks: BackgroundTasks):
    response = await agent_service.process(req)
    if response.operations:
        background_tasks.add_task(agent_service.apply_operations, response.operations)
    return response


# ── Agent Chat (streaming) ───────────────────────────

@app.post("/api/v1/agent/chat/stream")
async def agent_chat_stream(req: AgentRequest, background_tasks: BackgroundTasks):
    async def event_stream():
        operations = []
        async for event in agent_service.process_stream(req):
            if event["event"] == "done":
                try:
                    data = json.loads(event["data"])
                    operations = data.get("operations", [])
                except Exception:
                    pass
            yield f"event: {event['event']}\ndata: {event['data']}\n\n"

        # Fire topology analysis after stream ends (non-blocking)
        if operations:
            edit_ops = [op for op in operations if op.get("type") not in ("read_file",)]
            if edit_ops:
                import asyncio as _asyncio
                _asyncio.create_task(agent_service.apply_operations(edit_ops))

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Agent Plan (Planner + Sub-agent) ────────────────


# ── Topology refresh ────────────────────────────────

from pydantic import BaseModel as PydanticBaseModel

class DiffPayload(PydanticBaseModel):
    file: str
    diff: str

class TopologyRefreshRequest(PydanticBaseModel):
    diffs: list[DiffPayload] = []

@app.post("/api/v1/topology/refresh")
async def topology_refresh(req: TopologyRefreshRequest, background_tasks: BackgroundTasks):
    """Trigger topology analysis after file edits."""
    for d in req.diffs:
        background_tasks.add_task(topology_analyzer.analyze_diff, d.file, d.diff)
    return {"status": "ok", "files": len(req.diffs)}


# ── Intent classification ─────────────────────────

class IntentRequest(PydanticBaseModel):
    instruction: str

@app.post("/api/v1/agent/classify-intent")
async def classify_intent(req: IntentRequest):
    intent = await agent_service.classify_intent(req.instruction)
    return {"intent": intent}


# ── Agent Plan (Planner + Sub-agent) ────────────────

class PlanRequest(PydanticBaseModel):
    instruction: str

@app.post("/api/v1/agent/plan/stream")
async def agent_plan_stream(req: PlanRequest):
    """Phase 1: Planner agent explores and outputs a JSON plan."""
    async def gen():
        async for event in agent_service.plan_stream(req.instruction):
            yield f"event: {event['event']}\ndata: {event['data']}\n\n"
    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class StepRequest(PydanticBaseModel):
    task: str
    step_id: int

@app.post("/api/v1/agent/step/stream")
async def agent_step_stream(req: StepRequest):
    """Phase 2: Worker agent executes a single plan step."""
    async def gen():
        async for event in agent_service.run_sub_agent(req.task, req.step_id):
            yield f"event: {event['event']}\ndata: {event['data']}\n\n"
    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Topology stream ─────────────────────────────────

@app.get("/api/v1/topology/stream")
async def topology_stream(request: Request):
    async def event_generator():
        queue = await sse_manager.connect()
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield {"event": "topology_update", "data": payload}
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "{}"}
        finally:
            sse_manager.disconnect(queue)

    return EventSourceResponse(event_generator())


@app.get("/api/v1/health")
async def health():
    return {"status": "ok", "service": "code-atlas"}


# ── Change Queue & Summarizer ─────────────────────────

from pydantic import BaseModel as PydanticBaseModel2

class SummarizeRequest(PydanticBaseModel2):
    project_path: str
    operations: list[dict] = []

@app.post("/api/v1/changes/summarize")
async def summarize_changes(req: SummarizeRequest, background_tasks: BackgroundTasks):
    """Called after agent edits — summarize changes and push to queue."""
    if req.operations:
        background_tasks.add_task(change_summarizer.summarize, req.project_path, req.operations)
    return {"status": "ok"}


@app.get("/api/v1/changes/pending")
async def get_pending_changes(project_path: str = ""):
    """Right panel polls this to check for new changes."""
    if not project_path:
        return {"items": [], "has_pending": False}
    items = change_queue.pull_unprocessed(project_path)
    return {
        "items": [it.to_dict() for it in items],
        "has_pending": len(items) > 0,
    }


# ── Incremental feature update ──────────────────────

from pydantic import BaseModel as PydanticBaseModel3

class IncrementalUpdateRequest(PydanticBaseModel3):
    project_path: str
    change_summary: str = ""
    files_changed: list[str] = []

@app.post("/api/v1/features/incremental-update")
async def incremental_update(req: IncrementalUpdateRequest, background_tasks: BackgroundTasks):
    """Incrementally update features based on code changes (lightweight)."""
    background_tasks.add_task(
        feature_analyzer.incremental_update,
        req.project_path, req.change_summary, req.files_changed,
    )
    return {"status": "queued"}


# ── Overview generation ─────────────────────────────

from services.overview_agent import overview_agent

class OverviewRequest(PydanticBaseModel3):
    project_path: str
    node_id: str = ""
    files: list[str] = []
    language: str = "en"

@app.post("/api/v1/features/overview")
async def generate_overview(req: OverviewRequest, background_tasks: BackgroundTasks):
    """Autonomous agent: explore project and generate detailed overview."""
    result = await overview_agent.explore(req.project_path, req.language)
    # Save overview + issues to the feature node in DB
    if req.node_id and result.get("overview"):
        from services.db import find_feature, update_feature_overview
        node = find_feature(req.project_path, req.node_id)
        if node:
            node["flow_description"] = result["overview"]
            node["issues_json"] = json.dumps(result.get("issues", []), ensure_ascii=False)
            update_feature_overview(req.project_path, req.node_id, node)
    return result


# ── Feature Graph ───────────────────────────────────

@app.get("/api/v1/features")
async def get_features(project_path: str = ""):
    if not project_path:
        return {"features": [], "last_updated": ""}
    features = load(project_path)
    return {"features": features, "last_updated": ""}


@app.get("/api/v1/features/search")
async def search_features(project_path: str = "", query: str = "", limit: int = 8):
    if not project_path or not query.strip():
        return {"features": [], "symbols": []}
    return search_project_map(project_path, query, max(1, min(limit, 20)))


@app.post("/api/v1/features/analyze")
async def analyze_features(req: AnalyzeFeaturesRequest):
    project_path = req.project_path
    language = getattr(req, "language", "en") or "en"
    if req.node_id:
        try:
            nodes = await feature_analyzer.drill_down(project_path, req.node_id, req.parent_context or "", language)
            return {"nodes": [n.model_dump() for n in nodes]}
        except Exception as e:
            logger.error(f"[API] analyze_features error: {e}", exc_info=True)
            return {"nodes": [], "error": str(e)}
    return {"error": "Use analyze-top for top-level analysis"}


@app.post("/api/v1/features/analyze-top")
async def analyze_top_level(req: dict):
    project_path = req.get("project_path", "")
    file_tree = req.get("file_tree", [])
    language = req.get("language", "en")
    if not project_path:
        return {"error": "project_path required"}
    nodes = await feature_analyzer.analyze_top_level(project_path, file_tree, language)
    return {"features": [n.model_dump() for n in nodes]}


# ── Unified full-map analysis (single autonomous agent) ──

from pydantic import BaseModel as PydanticBaseModel4

class AnalyzeAllRequest(PydanticBaseModel4):
    project_path: str
    language: str = "en"

@app.post("/api/v1/features/analyze-all")
async def analyze_all_features(req: AnalyzeAllRequest):
    """Single autonomous agent: full 4-level feature graph in one call. Only needs project_path."""
    from services.unified_analyzer import unified_analyzer
    try:
        nodes = await unified_analyzer.analyze_all(req.project_path, req.language)
        return {"features": [n.model_dump() for n in nodes]}
    except Exception as e:
        logger.error(f"[API] analyze_all error: {e}", exc_info=True)
        return {"features": [], "error": str(e)}


@app.get("/api/v1/sse-test")
async def sse_test(request: Request):
    async def gen():
        for i in range(3):
            yield {"event": "test", "data": f"msg{i}"}
            await asyncio.sleep(0.5)
    return EventSourceResponse(gen())


@app.get("/api/v1/features/analyze-all/stream")
async def analyze_all_features_stream(request: Request, project_path: str = "", language: str = "en"):
    """Streaming version: SSE progress events, final event contains the complete feature graph."""
    from services.unified_analyzer import unified_analyzer

    async def gen():
        if await request.is_disconnected():
            return
        yield "event: connected\ndata: {}\n\n"
        async for ev in unified_analyzer.analyze_all_stream(project_path, language):
            if await request.is_disconnected():
                break
            yield f"event: {ev['event']}\ndata: {ev['data']}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
            "Content-Type": "text/event-stream",
        },
    )


# ── Incremental refresh (detect changed files, update only what's needed) ──

class IncrementalRefreshRequest(PydanticBaseModel4):
    project_path: str
    language: str = "en"

@app.post("/api/v1/features/incremental-refresh")
async def incremental_refresh_features(request: Request, req: IncrementalRefreshRequest):
    """Smart refresh: incremental if few changes, full otherwise. SSE streaming."""
    from services.unified_analyzer import unified_analyzer

    async def gen():
        if await request.is_disconnected():
            return
        yield "event: connected\ndata: {}\n\n"
        async for ev in unified_analyzer.incremental_refresh(req.project_path, req.language):
            if await request.is_disconnected():
                break
            yield f"event: {ev['event']}\ndata: {ev['data']}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
            "Content-Type": "text/event-stream",
        },
    )


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    index = frontend_dist / "index.html"
    if not index.is_file():
        return {"detail": "Frontend not built"}
    return FileResponse(index)
