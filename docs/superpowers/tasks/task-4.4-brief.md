# Task 4.4: Chat 对话页

**Work in:** `/Users/zhangsan/workpaw/workpaw-desktop`

## Context

This is the core feature of the desktop client. The Chat page allows users to interact with their QwenPaw Agent via streaming messages.

The QwenPaw Pod API (accessed via Ingress URL) provides:
- `GET /api/agents` — list available agents
- `GET /api/chats` — list chat sessions
- `POST /api/chats` — create a new chat session
- `GET /api/chats/:id` — get chat history
- `POST /api/console/chat` — send message (streaming SSE response)
- `POST /api/console/upload` — upload file attachment

Reference the QwenPaw source at `~/github/QwenPaw/console/src/pages/Chat/` and `~/github/QwenPaw/console/src/api/modules/chat.ts` for API details.

## Files to Create

### 1. `src/stores/useChatStore.ts`

Zustand store managing:
- `messages: ChatMessage[]` — current conversation messages
- `sessions: Session[]` — session list
- `currentSessionId: string | null`
- `streaming: boolean` — whether currently streaming
- `podUrl: string` — QwenPaw Pod Ingress URL
- `podToken: string` — QwenPaw Pod API token
- `setConnection(url, token)` — set Pod connection info
- `sendMessage(content: string)` — send message, handle SSE streaming response
- `loadSessions()` — fetch session list
- `selectSession(id)` — load session history
- `createSession()` — create new session

For `sendMessage`:
1. Add user message to messages array
2. Create empty assistant message placeholder
3. POST to `${podUrl}/api/console/chat` with message content
4. Read SSE stream, append chunks to assistant message content
5. Set streaming=false when done

For the API token, use the `api_token` from the Control Plane's `/api/instance/connect` response. Fetch this in App.tsx when instance is running, and call `setConnection(ingress_url, api_token)`.

### 2. `src/components/Chat/MessageList.tsx`

Scrollable message list component:
- Renders user and assistant messages as chat bubbles
- User messages: right-aligned, blue background
- Assistant messages: left-aligned, gray background
- Supports markdown rendering (use `react-markdown` if available, or plain text for now)
- Auto-scrolls to bottom on new messages
- Shows "正在思考..." indicator when streaming and no content yet

### 3. `src/components/Chat/ChatInput.tsx`

Input area component:
- Text input (textarea, auto-resize)
- Send button (disabled when streaming or empty input)
- Enter to send, Shift+Enter for newline
- Calls `useChatStore.sendMessage()` on submit

### 4. `src/components/Chat/SessionSidebar.tsx`

Left sidebar showing session list:
- "新建对话" button at top
- List of sessions sorted by updated_at
- Current session highlighted
- Click to switch session
- Uses `useChatStore.loadSessions()` and `selectSession()`

### 5. `src/pages/Chat.tsx`

Main Chat page layout:
```
┌─────────────────┐ ┌─────────────────────────────────┐
│ SessionSidebar  │ │ MessageList                      │
│                 │ │                                  │
│ [+新建对话]     │ │  [message bubbles]               │
│                 │ │                                  │
│ Session 1       │ │                                  │
│ Session 2       │ ├─────────────────────────────────┤
│ Session 3       │ │ ChatInput                        │
│                 │ │ [textarea] [发送]                │
└─────────────────┘ └─────────────────────────────────┘
```

### 6. Update `src/App.tsx`

When instance is running:
1. Fetch connect info: `GET /api/instance/connect` from Control Plane
2. Call `useChatStore.setConnection(ingress_url, api_token)`
3. Render Chat page

### 7. Install dependencies if needed

```bash
pnpm add react-markdown
```

### Acceptance

- Chat store handles message sending with SSE streaming
- MessageList renders messages with proper styling
- ChatInput handles text input and submission
- SessionSidebar shows session list and allows switching
- Chat page layout matches the enterprise WeChat style
- `pnpm build` passes
- Commit: `feat: implement Chat page with streaming, sessions, and sidebar`
