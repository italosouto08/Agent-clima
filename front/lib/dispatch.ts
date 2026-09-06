import type { StreamEvent } from "./types";

export type Renderer = "chat" | "tool";

export function routeEvent(payload: StreamEvent): Renderer {
  const type = payload.event;

  if (typeof type !== "string" || !type) {
    throw new Error("Evento sem tipo");
  }

  if (type.startsWith("on_chat_model_")) return "chat";
  if (type.startsWith("on_tool_")) return "tool";

  throw new Error(`Evento não suportado: ${type}`);
}
