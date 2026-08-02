/** QwenPaw 后端 PluginType 枚举值。 */
export type PluginType =
  | "tool"
  | "provider"
  | "hook"
  | "command"
  | "channel"
  | "frontend"
  | "app"
  | "general";

/** GET /api/plugins 单条记录。 */
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  enabled: boolean;
  /** 当前是否已加载进内存。 */
  loaded: boolean;
  plugin_type: PluginType;
  frontend_entry?: string;
}

export interface InstallPluginResult {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  loaded: boolean;
  message: string;
}

export interface PluginStatus {
  id: string;
  loaded: boolean;
  enabled: boolean;
  version?: string;
}

/** GET /api/plugins/catalog（官方 CDN 目录）单条。 */
export interface OfficialPluginCatalogEntry {
  id: string;
  plugin_id: string;
  name: string;
  description: string;
  /** locale 键控描述，如 { "zh-CN": "...", "en-US": "..." } */
  description_i18n?: Record<string, string>;
  version: string;
  author: string;
  kind: string;
  size: string;
  sha256: string;
  install_url: string;
  installed: boolean;
  installed_version?: string;
  upgrade_available: boolean;
}

export interface OfficialPluginCatalog {
  updated_at: string | null;
  plugins: OfficialPluginCatalogEntry[];
  error?: string | null;
}

export interface MarketPluginLocale {
  description: string;
  category: string;
}

/** GET /api/plugins/market/search 单条（AgentScope Platform 代理）。 */
export interface MarketPluginEntry {
  id: string;
  display_name: string;
  developer: string;
  owner: string;
  version: string;
  logo_url: string | null;
  downloads: number;
  view_count: number;
  details_url: string | null;
  locales: Record<string, MarketPluginLocale>;
  /** QwenPaw 大版本兼容标签，如 ["1.x"]。 */
  qwenpaw_compat_labels?: string[];
  is_featured?: boolean;
}

export type MarketPluginSortBy = "downloads" | "updated_time" | "fauvarate";

export interface PluginCategory {
  code: string;
  zh: string;
  en: string;
}

/** 社区市场 7 分类（对齐 QwenPaw console PLUGIN_CATEGORIES）。 */
export const PLUGIN_CATEGORIES: PluginCategory[] = [
  { code: "app", zh: "应用", en: "App" },
  { code: "agent-tool", zh: "Agent 工具", en: "Agent Tool" },
  { code: "provider", zh: "模型接入", en: "Provider" },
  { code: "command", zh: "Slash 命令", en: "Slash Command" },
  { code: "hook", zh: "生命周期 Hook", en: "Lifecycle Hook" },
  { code: "frontend", zh: "UI 扩展", en: "UI Extension" },
  { code: "general", zh: "通用插件", en: "General" },
];

/** 社区市场排序（fauvarate 为 QwenPaw 原文拼写，勿改）。 */
export const MARKET_SORT_OPTIONS: Array<{ value: MarketPluginSortBy; label: string }> = [
  { value: "downloads", label: "下载量最多" },
  { value: "updated_time", label: "最近更新" },
  { value: "fauvarate", label: "收藏最多" },
];
