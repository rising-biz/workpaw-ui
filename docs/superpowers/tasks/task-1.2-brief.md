# Task 1.2: QwenPaw API 类型定义

**Files to create in `/Users/zhangsan/workpaw/workpaw-ui/src/types/`:**

## 1. instance.ts
```typescript
export type InstanceStatus = "not_found" | "creating" | "running" | "stopped";

export interface InstancePolicy {
  idle_timeout_minutes: number;
  schedule_stop: string;
}

export interface InstanceInfo {
  status: InstanceStatus;
  ingress_url: string;
  api_token: string;
  created_at: string;
  last_active_at: string;
  policy: InstancePolicy;
}

export interface InstanceConnectResponse {
  ingress_url: string;
  api_token: string;
}
```

## 2. auth.ts
```typescript
export interface AuthUser {
  user_id: string;
  email: string;
  name: string;
  roles: string[];
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface AuthLoginResponse {
  auth_url: string;
}
```

## 3. chat.ts
```typescript
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
```

## 4. session.ts
```typescript
export interface Session {
  id: string;
  title: string;
  agent_id?: string;
  channel?: string;
  created_at: string;
  updated_at: string;
}
```

## 5. agent.ts
```typescript
export interface Agent {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  enabled: boolean;
}
```

## 6. Update src/index.ts to export all types

```typescript
export * from "./types/instance";
export * from "./types/auth";
export * from "./types/chat";
export * from "./types/session";
export * from "./types/agent";
```

**Acceptance:** All type files created, exported from index.ts, no TypeScript errors.
