export type ToolCall = {
  name?: string;
  args?: Record<string, unknown>;
};

export type StreamEvent = {
  event: string;
  name?: string;
  data?: {
    chunk?: { content?: string };
    output?: {
      content?: string;
      tool_calls?: ToolCall[];
    };
    input?: Record<string, unknown>;
  };
};

export type TimelineItem =
  | { id: string; kind: "user"; text: string }
  | {
      id: string;
      kind: "tool_call";
      name: string;
      args: Record<string, unknown>;
      status: "running" | "done";
    }
  | { id: string; kind: "tool_result"; name: string; content: string }
  | { id: string; kind: "assistant"; text: string; streaming: boolean }
  | { id: string; kind: "error"; text: string };
