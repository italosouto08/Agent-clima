from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.responses import StreamingResponse
from app.agent import stream_sse

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class ExecuteBody(BaseModel):
    message: str

@app.post("/agent/execute")
async def agent_execute(body: ExecuteBody):
    return StreamingResponse(stream_sse(body.message), media_type="text/event-stream")