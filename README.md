# Agent-clima

Chat com um agent de clima. O modelo decide se chama a tool `get_weather`, o servidor devolve o fluxo em SSE e o front pinta a consulta ao vivo.

## Requisitos

- Python 3.10+
- Node.js 20+
- chave da OpenAI (`OPENAI_API_KEY`)

## Como subir

### 1. Segredo

Na **raiz** do repositório, crie um `.env`:

```
OPENAI_API_KEY=sk-...
```

### 2. API

Na raiz:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

No macOS/Linux, o activate é `source .venv/bin/activate`.

A API sobe em [http://127.0.0.1:8000](http://127.0.0.1:8000).

- `POST /agent/execute`
- body: `{"message": }`
- resposta: `text/event-stream`

Docs interativas: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

### 3. Front

Em **outro** terminal, com a API ainda no ar:

```powershell
cd front
copy .env.example .env.local
npm install
npm run dev
```

No macOS/Linux: `cp .env.example .env.local`.

Abra [http://localhost:3000](http://localhost:3000). O front chama `http://127.0.0.1:8000` (veja `front/.env.local`).

## Smoke

Com API e front rodando, pergunte: **Qual o clima em São Paulo?**

## Estrutura

```
app/tools.py    stub get_weather
app/graph.py    LangGraph (modelo ↔ tools)
app/agent.py    astream_events v2 → SSE
app/main.py     POST /agent/execute
front/          Next.js + Tailwind
```
