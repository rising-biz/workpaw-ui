export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ChatSpec {
  id: string;
  title: string;
  agent_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ChatHistory {
  chat: ChatSpec;
  messages: ChatMessage[];
}

export interface SendMessageRequest {
  message: string;
  agent_id?: string;
  files?: string[];
}

export interface ChatUploadResponse {
  url: string;
  file_name: string;
  stored_name?: string;
}
