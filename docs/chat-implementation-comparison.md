# WorkPaw vs QwenPaw Console 聊天逻辑对比分析

## 概述

本文档对比 WorkPaw 桌面端和 QwenPaw Console 的聊天实现，识别关键差异并记录修复内容。

---

## 1. 模型配置检查

### QwenPaw Console
```typescript
// Chat/index.tsx:1969-1983
const activeModels = await providerApi.getActiveModels({
  scope: "effective",
  agent_id: selectedAgent,
});
if (!activeModels?.active_llm?.provider_id || !activeModels?.active_llm?.model) {
  setShowModelPrompt(true);
  return buildModelError();
}
```

**行为**: 发送消息前检查是否有有效模型配置，如果没有则显示模型选择提示。

### WorkPaw (修复前)
```typescript
// useChatStore.ts:sendMessage
// 没有模型配置检查，直接发送请求
```

**问题**: 如果未配置模型，请求会失败但用户看不到明确提示。

### WorkPaw (修复后)
目前暂未添加此检查。建议后续添加以提升用户体验。

---

## 2. API 作用域 (Scope) 参数

### QwenPaw Console
```typescript
// provider.ts:473-477
getActiveModels: (params?: { scope?: string; agent_id?: string }) => {
  const sp = new URLSearchParams();
  if (params?.scope) sp.set("scope", params.scope);
  if (params?.agent_id) sp.set("agent_id", params.agent_id);
  return request<ActiveModelsInfo>(`/models/active?${sp.toString()}`);
}
```

**行为**: 
- `scope: "effective"` - 优先返回 agent 级别配置，否则返回全局配置
- `scope: "agent"` - 仅返回 agent 级别配置（需要 agent_id）

### WorkPaw (修复前)
```typescript
// podApi.ts:252-256
export function getActiveModel(agentId?: string) {
  const params = new URLSearchParams();
  params.set("scope", "agent");  // ❌ 硬编码为 "agent"
  if (agentId) params.set("agent_id", agentId);
  return podRequest(`/models/active?${params.toString()}`);
}
```

**问题**: 当 agentId 为空时，请求 `scope=agent` 但没有 `agent_id`，后端返回 400 错误。

### WorkPaw (修复后)
```typescript
// podApi.ts:252-259
export function getActiveModel(agentId?: string) {
  const params = new URLSearchParams();
  params.set("scope", "effective");  // ✅ 使用 "effective"
  if (agentId) params.set("agent_id", agentId);
  return podRequest(`/models/active?${params.toString()}`);
}
```

**修复**: 使用 `scope: "effective"` 作为默认值，自动回退到全局配置。

---

## 3. 设置激活模型

### WorkPaw (修复前)
```typescript
// podApi.ts:261-275
export function setActiveModel(providerId, model, agentId?) {
  return podRequest("/models/active", {
    method: "PUT",
    body: JSON.stringify({
      provider_id: providerId,
      model,
      scope: "agent",  // ❌ 硬编码
      agent_id: agentId || "",  // ❌ 可能为空字符串
    }),
  });
}
```

**问题**: 当 agentId 为空时，发送 `scope: "agent"` 和 `agent_id: ""`，后端返回 400 错误。

### WorkPaw (修复后)
```typescript
// podApi.ts:261-278
export function setActiveModel(providerId, model, agentId?) {
  const body: Record<string, string> = {
    provider_id: providerId,
    model,
    scope: agentId ? "agent" : "global",  // ✅ 动态选择
  };
  if (agentId) body.agent_id = agentId;  // ✅ 只在有值时添加
  return podRequest("/models/active", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
```

**修复**: 根据是否有 agentId 动态选择 scope，避免空值。

---

## 4. 模型选择器 - API Key 检查

### QwenPaw Console
```typescript
// ModelSelector/index.tsx:163-178
const proProviders = providers.filter((p) => {
  const hasApiKey = !!p.api_key;  // ✅ 直接检查 api_key 字符串
  return (
    p.models.length > 0 &&
    (hasApiKey || p.require_api_key === false || p.is_custom || p.is_local)
  );
});
```

**行为**: 使用 `!!p.api_key` 检查 API Key 是否存在（后端返回 masked 字符串如 `"sk-******"`）。

### WorkPaw (修复前)
```typescript
// ModelSelector.tsx:53-58
const isConfigured = (p: ProviderInfo) =>
  p.has_api_key ||  // ❌ 使用 has_api_key 字段
  p.require_api_key === false ||
  p.is_custom ||
  p.is_local;
```

**问题**: 后端不返回 `has_api_key` 字段，导致该值始终为 `undefined`，PRO 标签页为空。

### WorkPaw (修复后)
```typescript
// ModelSelector.tsx:53-54
const isConfigured = (p: ProviderInfo) =>
  !!p.api_key ||  // ✅ 直接检查 api_key 字符串
  p.require_api_key === false ||
  p.is_custom ||
  p.is_local;
```

**修复**: 移除对 `has_api_key` 的依赖，直接检查 `api_key` 字段。

同时从 `podApi.ts` 的 `ProviderInfo` 接口中移除了 `has_api_key` 字段定义。

---

## 5. 文件上传内容格式 ⭐ 关键差异

### QwenPaw Console
```typescript
// Chat/index.tsx:165-182
function buildAttachmentContentItems(attachments) {
  return attachments.map((a) => {
    const storedUrl = toStoredName(a.url);
    if (a.type?.startsWith("image/")) {
      return { type: "image", image_url: storedUrl };
    }
    if (a.type?.startsWith("video/")) {
      return { type: "video", video_url: storedUrl };
    }
    if (a.type?.startsWith("audio/")) {
      return { type: "audio", data: storedUrl };
    }
    return { type: "file", file_url: storedUrl, file_name: a.name || "file" };
  });
}
```

**行为**: 根据文件类型使用不同的 content part 类型：
- 图片: `{ type: "image", image_url: "filename" }`
- 视频: `{ type: "video", video_url: "filename" }`
- 音频: `{ type: "audio", data: "filename" }`
- 其他文件: `{ type: "file", file_url: "filename", file_name: "name" }`

### WorkPaw (修复前)
```typescript
// useChatStore.ts:467-472
...files.map((f) => ({
  type: "file_url",  // ❌ 统一使用 file_url
  file_url: { url: f.url, name: f.name },  // ❌ 嵌套对象格式
})),
```

**问题**: 
1. 使用 `type: "file_url"` 而不是根据文件类型区分
2. `file_url` 是嵌套对象 `{ url, name }` 而不是简单字符串
3. 后端无法正确解析，导致聊天失败

### WorkPaw (修复后)
```typescript
// useChatStore.ts:467-485
...files.map((f) => {
  const fileType = f.type || "";
  if (fileType.startsWith("image/")) {
    return { type: "image", image_url: f.url };
  }
  if (fileType.startsWith("video/")) {
    return { type: "video", video_url: f.url };
  }
  if (fileType.startsWith("audio/")) {
    return { type: "audio", data: f.url };
  }
  return { type: "file", file_url: f.url, file_name: f.name };
}),
```

同时更新 `ChatInput.tsx` 传递文件类型：
```typescript
// ChatInput.tsx:86-90
uploadedFiles.push({
  url: result.url || result.stored_name || "",
  name: result.file_name || file.filename || "file",
  type: file.mediaType || blob.type,  // ✅ 添加类型信息
});
```

**修复**: 完全匹配 QwenPaw 的内容格式规范。

---

## 6. 超时和错误处理

### QwenPaw Console
```typescript
// 使用 @agentscope-ai/chat SDK
// SDK 内部处理超时和错误
```

**行为**: 依赖第三方 SDK 的内置机制。

### WorkPaw (修复前)
```typescript
// useChatStore.ts:sendMessage
// 没有超时机制
// 错误时设置 streaming = false，但没有用户提示
```

**问题**: 
1. 如果后端无响应，前端会无限等待
2. 用户看不到明确的错误提示

### WorkPaw (修复后)
```typescript
// useChatStore.ts:498-515
const IDLE_TIMEOUT_MS = 60_000;  // 60秒空闲超时
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let timedOut = false;

const resetIdleTimer = () => {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, IDLE_TIMEOUT_MS);
};

// 每次收到 SSE 数据时重置计时器
resetIdleTimer();

// 错误处理
} catch (err: unknown) {
  if (timedOut) {
    // 超时错误
    addMessage({
      role: "assistant",
      content: "⚠️ 模型响应超时，请检查模型配置或稍后重试",
    });
  } else if (err instanceof Error && err.name === "AbortError") {
    // 用户主动停止，静默处理
  } else {
    // 其他错误
    addMessage({
      role: "assistant",
      content: `⚠️ 消息发送失败: ${err instanceof Error ? err.message : "未知错误"}`,
    });
  }
}
```

**修复**: 
1. 添加 60 秒空闲超时（每次收到数据重置）
2. 区分超时、用户停止、其他错误
3. 向用户显示明确的错误提示

---

## 7. 请求体结构对比

### 共同点
```typescript
{
  input: [{ role: "user", content: "..." }],
  session_id: "session-uuid" | "",
  user_id: "default" | "user-id",
  channel: "console",
  stream: true
}
```

### 差异点
| 字段 | QwenPaw Console | WorkPaw |
|------|----------------|---------|
| `input[].content` (带文件) | 多类型 content parts | 已修复为多类型 ✅ |
| `biz_params` | 支持 | 支持 |
| Headers | `X-Agent-Id` (必选) | `X-Agent-Id` (必选) |

---

## 8. SSE 流解析

### 共同点
两者都支持以下 SSE 事件格式：
- `[DONE]` - 流结束标记
- `{ choices: [{ delta: { content: "..." } }] }` - OpenAI 兼容格式
- `{ object: "message", type: "..." }` - QwenPaw 内部事件
- `{ object: "response", output: [...] }` - 响应完成事件

### 差异点
| 特性 | QwenPaw Console | WorkPaw |
|------|----------------|---------|
| 插件转换 | 支持 request/response transforms | 不支持 |
| Usage 统计 | 解析 turn_usage 事件 | 忽略 |
| Rate limit | 处理 rate_limited 事件 | 忽略 |

---

## 总结：已修复的关键问题

1. ✅ **API 作用域参数** - 使用 `scope: "effective"` 替代硬编码的 `"agent"`
2. ✅ **模型选择器 API Key 检查** - 使用 `!!p.api_key` 替代 `p.has_api_key`
3. ✅ **文件上传内容格式** - 根据文件类型使用正确的 content part 类型
4. ✅ **超时机制** - 添加 60 秒空闲超时和错误提示
5. ✅ **设置激活模型** - 动态选择 scope 避免空 agent_id

---

## 待改进项

1. **模型配置检查** - 发送前检查是否有有效模型配置
2. **插件系统** - 支持请求/响应转换插件
3. **Usage 统计** - 解析和显示 token 使用量
4. **Rate limit 处理** - 优雅处理限流错误

---

## 调试建议

如果聊天仍然失败，请按以下步骤排查：

1. **检查浏览器控制台** - 查看是否有错误日志
2. **检查网络面板** - 查看 `/api/console/chat` 请求：
   - 请求体格式是否正确
   - 响应状态码
   - SSE 流是否正常返回数据
3. **检查后端日志** - 查看是否有异常抛出
4. **对比 QwenPaw Console** - 在相同配置下测试，对比请求/响应差异
5. **检查模型配置** - 确认模型 API Key 有效且可访问

---

## 文件变更清单

| 文件 | 变更内容 |
|------|---------|
| `src/lib/podApi.ts` | 修复 getActiveModel/setActiveModel 的 scope 参数，移除 has_api_key 字段 |
| `src/stores/useChatStore.ts` | 修复文件上传内容格式，添加超时机制 |
| `src/components/Chat/ChatInput.tsx` | 传递文件类型信息 |
| `src/components/Chat/ModelSelector.tsx` | 修复 API Key 检查逻辑 |
