import json
from app.graph import compiled
from langchain_core.messages import HumanMessage

def json_default(obj):
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    return str(obj)

async def execute(message: str):
    async for event in compiled.astream_events(
        {"messages": [HumanMessage(content=message)]},
        version = 'v2',
        include_types=["chat_model", "tool"],
    ): yield event

async def stream_sse(message):
    async for event in execute(message):
        payload = json.dumps(event, default=json_default, ensure_ascii=False)
        yield f"event: {event['event']}\ndata: {payload}\n\n"

if __name__ == "__main__": 
    import asyncio
    async def main():
        async for chunk in stream_sse("Qual o clima em Recife?"):
            print(chunk)

    asyncio.run(main())