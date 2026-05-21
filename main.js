'use strict';

// ─────────────────────────────────────────────────────────────────
// Open Bridge for Obsidian · v0.9.2
//
// 历史 + 记忆: 对话自动回流 vault 成为可搜索可双链的 MD 文档
//
// v0.6 新增:
//   ⭐ 自动保存对话到 _shared/ai-sessions/{date}-{title}.md
//   ⭐ 每个 session 带 frontmatter (backend/model/cost/tokens/messages)
//   ⭐ Dataview 友好: 可统计 / 可双链 / 可标签
//   ⭐ Header 显示 "📁 saved as XXX.md" (点击打开)
//   ⭐ 命令: "Open AI sessions folder"
//   ⭐ 自动生成 session title (首条用户消息前 50 字符)
//   ⭐ 工具调用摘要 (file path / bash command) 保留在 MD 里
//
// v0.5 保留: 多 backend (Claude/Codex/Custom)
// v0.4 保留: stream-json 工具卡片 / diff / 多轮 / 4 模式
// v0.3 保留: 附件 / 斜杠 / 多实例 / VS Code 视觉
// ─────────────────────────────────────────────────────────────────
//
// v0.7 新增 (Figma Bridge 集成):
//   ⭐ /figma 斜杠命令族 (status / connect / stop / info)
//   ⭐ Header Figma 状态指示灯 (🟢/🟡/⚫)
//   ⭐ 状态 30s 自动刷新
//
// v0.8 新增 (Resume 历史 session):
//   ⭐ Header 🕐 History 按钮 → 弹出 SessionPickerModal
//   ⭐ 从 _shared/ai-sessions/ 列举所有历史 (按 mtime 排序)
//   ⭐ 显示 title / backend / 消息数 / cost
//   ⭐ 点击 → 把 messages 渲染回 view + 设 sessionId + 后续消息自动 --resume
//   ⭐ 命令: "🤖 Resume AI session..." (推荐绑 Cmd+Option+H)
// ─────────────────────────────────────────────────────────────────

const obsidian = require('obsidian');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const VIEW_TYPE_CLAUDE_BRIDGE = 'open-bridge-view';
const APP_NAME = 'Open Bridge';
const PLUGIN_VERSION = '0.9.2';
const SESSIONS_DIR = '_shared/ai-sessions';
const FIGMA_BRIDGE_PORT = 3055;
const FIGMA_STATUS_REFRESH_MS = 30000;
const BACKEND_RUN_TIMEOUT_MS = 120000;
const QUICK_SCAN_MAX_DEPTH = 3;
const QUICK_SCAN_MAX_ITEMS = 260;
const PROMPT_CONTEXT_MAX_MESSAGES = 8;
const PROMPT_CONTEXT_MAX_CHARS = 6000;
const ACTIVE_CONTEXT_MAX_ITEMS = 12;
const ACTIVE_CONTEXT_MAX_CHARS = 12000;
const QUICK_SCAN_IGNORES = new Set([
  '.git', '.obsidian', 'node_modules', 'dist', 'build', '.next', '.nuxt', 'coverage',
  '.DS_Store', '__pycache__', '.venv', 'venv', 'Pods', 'DerivedData'
]);
const CODEX_REPO_MODES = {
  auto: 'Auto 自动判断',
  git: 'Git 项目模式',
  local: '本地 Vault 模式',
};
const MODEL_GATEWAY_PRESETS = {
  custom: {
    label: '自定义兼容接口',
    baseUrl: '',
    model: '',
    wireApi: 'responses',
    auth: true,
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.5',
    wireApi: 'responses',
    auth: true,
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-5.5',
    wireApi: 'responses',
    auth: true,
  },
  litellm: {
    label: 'LiteLLM / One API',
    baseUrl: 'http://127.0.0.1:4000/v1',
    model: 'gpt-5.5',
    wireApi: 'responses',
    auth: true,
  },
  ollama: {
    label: 'Ollama 本地',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'gpt-oss:20b',
    wireApi: 'responses',
    auth: false,
  },
  company: {
    label: '企业私有网关',
    baseUrl: '',
    model: 'gpt-5.5',
    wireApi: 'responses',
    auth: true,
  },
};

const LANGUAGE_OPTIONS = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
};

const I18N = {
  zh: {
    commandNewChat: '🤖 新建 Open Bridge 对话（新面板）',
    commandRevealChat: '🤖 显示 Open Bridge 对话',
    commandCurrentPane: '🤖 在当前面板打开 Open Bridge',
    commandPanel: '🤖 Open Bridge 面板',
    commandOpenSessions: '📁 打开 AI sessions 目录',
    commandResumeSession: '🕐 恢复 AI 会话（从历史选择）',
    commandReload: '🔄 重载 Open Bridge',
    commandSetupGateway: '🔌 配置模型网关',
    commandSetupCompanyGateway: '🏢 配置企业 Codex 网关（旧入口）',
    commandAddActiveFileContext: '📌 将当前文件加入 Open Bridge 上下文',
    commandAddSelectionContext: '📌 将选中文本加入 Open Bridge 上下文',
    ribbonOpenNewChat: '新建 Open Bridge 对话',
    menuAddFileContext: '加入 Open Bridge 上下文',
    menuAddSelectionContext: '把选中文本加入 Open Bridge 上下文',
    menuAddCurrentFileContext: '把当前文件加入 Open Bridge 上下文',
    noticeNoActiveFile: '当前没有打开的文件',
    noticeCannotOpenPanel: '无法打开 Open Bridge 面板',
    noticeContextAdded: '已加入上下文: {path}',
    noticeNoMarkdownFile: '当前没有打开的 Markdown 文件',
    noticeSelectionAdded: '已加入选中文本: {path}:{line}',
    noticeSessionsMissing: 'Sessions 目录还不存在: {dir} — 跑过一次对话就会自动创建',
    noticePluginReloadUnsupported: '当前 Obsidian 版本不支持插件内重载，请手动关闭再开启插件。',
    noticeReloading: '正在重载 Open Bridge...',
    noticeReloadFailed: '重载失败，请手动关闭再开启插件: {message}',
    noticeLanguageChanged: '界面语言已切换，新开的 Open Bridge 面板会使用新语言。',
    errorNoHome: '找不到用户主目录，无法写入 Codex 配置。',
    statusReady: '就绪',
    statusReadyCwd: '就绪 · cwd = vault root',
    sessionNew: 'new session',
    figmaOff: '⚫ Figma off',
    figmaHint: '点击: /figma status\n双击: /figma connect',
    headerHistory: '历史会话 (resume from MD)',
    headerStop: '停止 (Esc)',
    headerNewSession: '新会话 (新 session)',
    headerMore: '更多操作',
    menuReload: '重载 Open Bridge',
    menuClear: '清空当前对话',
    menuGateway: '模型网关接入',
    menuOpenSessions: '打开 Sessions 目录',
    modeLabel: 'AI',
    modeTitle: '运行模式',
    modelTitle: '点击进设置改模型',
    inputPlaceholder: '问 Open Bridge 任何事... (粘贴图片 / 拖拽文件 / /help)',
    toolbarAttach: '附加文件',
    toolbarPin: '加入当前文件上下文',
    toolbarSlash: '斜杠命令',
    toolbarMic: '语音输入 (v0.6)',
    sendLabel: '发送 (Enter)，换行用 Shift+Enter',
    welcomeTitle: '👋 Open Bridge v{version} · 多 Backend 知识库操作面板',
    welcomeLine: 'cwd = vault 根目录, AI Backend 看得到所有资产文件。',
    welcomeFeaturesTitle: '✨ v0.4 新增',
    welcomeAskTitle: '💡 试试问我',
    welcomeHint: '💡 提示: 粘贴截图 / 拖拽文件即附件; /help 看命令; 顶部 ➕ 新开 session',
    featureToolVisible: '工具调用实时可见 (Read/Edit/Bash/Grep 等)',
    featureDiff: '文件 diff 行内显示',
    featureMultiTurn: '多轮对话 (按 + 新开 session, 否则自动 resume)',
    featureModes: '4 个模式: Default / Plan / Accept / Bypass',
    featureCost: 'Cost / Token 用量显示',
    examplePluginStatus: '检查 .obsidian/plugins/ 所有插件状态',
    exampleDesignTokens: '读 _shared/design-tokens/hanxue/DESIGN.md 并总结',
    exampleBrief: '基于 _shared/templates/new-brief.md 生成一份示例 brief',
    exampleTokenReview: '帮我审 designers/easiao/.../new-homepage/index.html 的 token 化率',
    contextLabel: 'Context',
    contextHint: '这些内容会随下一次消息一起发给 AI',
    contextAIQuote: 'AI 引用',
    contextRemove: '移除上下文',
    contextClear: '清空',
    remove: '移除',
    modeDefaultDesc: '正常模式, 工具调用要求权限',
    modePlanDesc: '只规划不执行, 用于复杂任务先讨论',
    modeAcceptEditsDesc: '文件编辑免审批, Bash 仍需审批',
    modeBypassDesc: '⚠ 所有工具调用免审批, 自治执行',
    statusBackend: 'Backend: {backend} · {path}',
    statusMode: '模式: {mode} · {desc}',
    statusNewSession: '🆕 新 session',
    statusContextAdded: '📌 已加入上下文: {name}',
    settingIntro: '多 AI Backend (Claude / Codex / Custom CLI) · 每个 backend 独立配置',
    settingLanguageName: '界面语言',
    settingLanguageDesc: '选择 Open Bridge 的界面语言。当前聊天不会被清空，新面板会使用新语言。',
    settingGatewayName: '模型网关接入',
    settingGatewayDesc: '适合社区发布：可接 OpenAI、OpenRouter、LiteLLM、Ollama 或企业私有网关。',
    settingOpenWizard: '打开配置向导',
    settingShowNextLaunch: '下次启动重新提示',
    noticeSetupPromptRestored: '已恢复首次配置提示',
    settingDefaultBackend: '默认 Backend',
    settingDefaultBackendDesc: '新开 chat 时默认用哪个 AI backend',
    settingDefaultMode: '默认模式',
    settingDefaultModeDesc: '新开 chat 时默认 mode。Codex 会映射到 sandbox / bypass 参数',
    settingCodexRepoMode: 'Codex 运行环境',
    settingCodexRepoModeDesc: 'Auto: 有 .git 按 Git 项目跑；没有 .git 自动允许本地 Vault。Git 项目模式更严格，本地 Vault 模式会跳过 Git 仓库检查。',
    repoAuto: 'Auto 自动判断',
    repoGit: 'Git 项目模式',
    repoLocal: '本地 Vault 模式',
    backendFullTools: '完整工具调用可见',
    backendTextStream: '文本流式',
    settingCliPath: 'CLI 路径',
    settingCliPathDesc: '默认 `{defaultPath}`。可填绝对路径如 /opt/homebrew/bin/{defaultPath}',
    cliPlaceholder: 'CLI 命令',
    settingDefaultModel: '默认模型',
    modelDescClaude: '例: claude-opus-4-7 / claude-sonnet-4-6',
    modelDescCodex: '例: gpt-5 / o4 / 公司内部 model name',
    modelDescOptional: '可选',
    modelPlaceholder: '(留空 = 默认)',
    settingExtraArgs: '额外参数',
    settingExtraArgsDesc: '追加到 CLI 命令的参数, 空格分隔',
    settingGeneral: '通用',
    settingSessionsDir: 'Sessions 目录 (vault 内)',
    settingSessionsDirDesc: '每轮对话自动保存到这里, 默认 _shared/ai-sessions',
    settingAutoSave: 'Auto-save sessions',
    settingAutoSaveDesc: '每轮对话自动写入 vault 成 MD 文件. 关闭后只在内存, 关 pane 即丢失.',
    settingAttachmentsDir: '附件目录 (vault 内相对路径)',
    settingShowThinking: '显示 Thinking 块',
    settingShowThinkingDesc: '支持结构化 thinking 的 backend 会显示，默认折叠',
    settingShowCost: '显示 Cost / Token 用量',
    settingShowCostDesc: '每轮对话结束后显示在底部',
    settingAutoCollapse: '工具卡片默认折叠',
    settingAutoCollapseDesc: '收起来更紧凑, 点 header 展开看详情',
    settingCapabilities: 'v0.4 实装能力',
    modalGatewayTitle: '模型网关接入',
    modalGatewayIntro: '可以使用 Codex 订阅账号登录，也可以使用 API Key 接入任意 OpenAI-compatible 网关。',
    modalConnectionMode: '接入方式',
    modalConnectionModeDesc: '订阅账号适合已登录 Codex CLI；API Key 适合 OpenAI、OpenRouter、LiteLLM、Ollama 或企业网关',
    modalSubscriptionOption: '订阅账号 / Codex CLI 登录',
    modalApiOption: 'API Key / 模型网关',
    modalSubscriptionName: '订阅账号登录',
    modalSubscriptionDesc: '使用 Codex CLI 当前登录的账号。若未登录，请先在系统终端运行 codex login。',
    modalPreset: '接口预设',
    modalPresetDesc: '预设只负责填充地址和推荐模型，仍可手动修改',
    modalBaseUrl: 'API 请求地址',
    modalBaseUrlDesc: 'OpenAI-compatible Base URL，例如 https://api.openai.com/v1',
    modalModelName: '模型名称',
    modalModelNameDesc: '订阅模式可留空使用 Codex 默认模型；API 模式填写网关暴露的模型名',
    modalWireApiDesc: 'Codex 与模型网关通信的协议。优先使用 responses；不兼容时再试 chat。',
    modalReasoning: '推理强度',
    modalReasoningDesc: '建议默认 high',
    modalRequiresKey: '需要 API Key',
    modalRequiresKeyDesc: '云端网关通常需要；本地服务如 Ollama 可关闭',
    modalApiKeyDesc: '只用于本次登录，插件不会保存明文',
    modalApiKeyPlaceholder: '粘贴 API Key',
    modalLater: '稍后',
    modalSaveLogin: '保存并登录',
    modalApiStatus: '保存后会写入本机 ~/.codex/config.toml，并用 API Key 调用 Codex 登录。',
    modalSubStatus: '保存后会切到 Codex CLI 订阅模式，并检查本机 codex login 状态。',
    modalBaseUrlError: '请填写完整的 API 请求地址，必须以 http:// 或 https:// 开头。',
    modalModelError: '请填写模型名称。',
    modalApiKeyError: '请填写 API Key。',
    modalConfiguring: '配置中...',
    modalWriting: '正在写入 Codex 配置并登录，请稍等。',
    modalLoginMayFail: '配置文件已写入，但 Codex 登录返回异常。请用 /doctor 查看状态。',
    noticeCodexLoginMayFail: 'Codex 登录可能失败，请执行 /doctor 检查。',
    modalRetryLogin: '重新登录',
    noticeGatewayReady: '模型网关已配置完成',
    modalWritten: '已写入 {path}，新聊天默认使用 Codex。',
    modalChecking: '检查中...',
    modalCheckingSubscription: '正在保存订阅模式配置，并检查 Codex CLI 登录状态。',
    modalSubscriptionNotLogged: '已切到订阅模式，但本机 Codex 可能未登录。请在系统终端运行 codex login，然后用 /doctor 检查。',
    noticeRunCodexLogin: '请先在系统终端运行 codex login',
    modalRecheck: '重新检查',
    noticeSubscriptionReady: 'Codex 订阅模式已启用',
    modalSubscriptionWritten: '已写入 {path}，新聊天默认使用 Codex CLI 订阅账号。',
    modalSaveCheck: '保存并检查',
  },
  en: {
    commandNewChat: '🤖 New Open Bridge chat (new pane)',
    commandRevealChat: '🤖 Reveal Open Bridge chat',
    commandCurrentPane: '🤖 Open Bridge chat in current pane',
    commandPanel: '🤖 Open Bridge panel',
    commandOpenSessions: '📁 Open AI sessions folder',
    commandResumeSession: '🕐 Resume AI session (pick from history)',
    commandReload: '🔄 Reload Open Bridge',
    commandSetupGateway: '🔌 Configure model gateway',
    commandSetupCompanyGateway: '🏢 Configure company Codex gateway (legacy)',
    commandAddActiveFileContext: '📌 Add current file to Open Bridge context',
    commandAddSelectionContext: '📌 Add selection to Open Bridge context',
    ribbonOpenNewChat: 'Open a new Open Bridge chat',
    menuAddFileContext: 'Add to Open Bridge context',
    menuAddSelectionContext: 'Add selected text to Open Bridge context',
    menuAddCurrentFileContext: 'Add current file to Open Bridge context',
    noticeNoActiveFile: 'No active file is open',
    noticeCannotOpenPanel: 'Cannot open Open Bridge panel',
    noticeContextAdded: 'Added to context: {path}',
    noticeNoMarkdownFile: 'No Markdown file is open',
    noticeSelectionAdded: 'Added selected text: {path}:{line}',
    noticeSessionsMissing: 'Sessions folder does not exist yet: {dir}. It will be created after the first conversation.',
    noticePluginReloadUnsupported: 'This Obsidian version does not support reloading a plugin here. Disable and enable it manually.',
    noticeReloading: 'Reloading Open Bridge...',
    noticeReloadFailed: 'Reload failed. Disable and enable the plugin manually: {message}',
    noticeLanguageChanged: 'Interface language updated. New Open Bridge panels will use it.',
    errorNoHome: 'Cannot find the user home directory, so Codex config cannot be written.',
    statusReady: 'Ready',
    statusReadyCwd: 'Ready · cwd = vault root',
    sessionNew: 'new session',
    figmaOff: '⚫ Figma off',
    figmaHint: 'Click: /figma status\nDouble-click: /figma connect',
    headerHistory: 'Session history (resume from MD)',
    headerStop: 'Stop (Esc)',
    headerNewSession: 'New chat (new session)',
    headerMore: 'More actions',
    menuReload: 'Reload Open Bridge',
    menuClear: 'Clear current chat',
    menuGateway: 'Model gateway setup',
    menuOpenSessions: 'Open Sessions folder',
    modeLabel: 'AI',
    modeTitle: 'Run mode',
    modelTitle: 'Open settings to change model',
    inputPlaceholder: 'Ask Open Bridge anything... (paste images / drop files / /help)',
    toolbarAttach: 'Attach files',
    toolbarPin: 'Add current file to context',
    toolbarSlash: 'Slash commands',
    toolbarMic: 'Voice input (v0.6)',
    sendLabel: 'Send (Enter), newline with Shift+Enter',
    welcomeTitle: '👋 Open Bridge v{version} · Multi-backend knowledge workspace',
    welcomeLine: 'cwd = vault root. The AI backend can access your asset files.',
    welcomeFeaturesTitle: '✨ What is included',
    welcomeAskTitle: '💡 Try asking',
    welcomeHint: '💡 Tip: paste screenshots or drop files as attachments; use /help for commands; use ➕ for a new session',
    featureToolVisible: 'Live tool activity (Read/Edit/Bash/Grep, etc.)',
    featureDiff: 'Inline file diffs',
    featureMultiTurn: 'Multi-turn chat (use + for a new session, otherwise resume)',
    featureModes: '4 modes: Default / Plan / Accept / Bypass',
    featureCost: 'Cost / token usage display',
    examplePluginStatus: 'Check all plugins under .obsidian/plugins/',
    exampleDesignTokens: 'Read _shared/design-tokens/hanxue/DESIGN.md and summarize it',
    exampleBrief: 'Generate an example brief from _shared/templates/new-brief.md',
    exampleTokenReview: 'Review token usage in designers/easiao/.../new-homepage/index.html',
    contextLabel: 'Context',
    contextHint: 'These items will be sent with your next message',
    contextAIQuote: 'AI quote',
    contextRemove: 'Remove context',
    contextClear: 'Clear',
    remove: 'Remove',
    modeDefaultDesc: 'Normal mode; tool calls require approval',
    modePlanDesc: 'Plan only; useful before complex work',
    modeAcceptEditsDesc: 'File edits do not need approval; Bash still does',
    modeBypassDesc: '⚠ All tool calls skip approval; autonomous execution',
    statusBackend: 'Backend: {backend} · {path}',
    statusMode: 'Mode: {mode} · {desc}',
    statusNewSession: '🆕 New session',
    statusContextAdded: '📌 Added to context: {name}',
    settingIntro: 'Multiple AI backends (Claude / Codex / Custom CLI) · configured independently',
    settingLanguageName: 'Interface language',
    settingLanguageDesc: 'Choose the Open Bridge UI language. Current chats stay open; new panels use the new language.',
    settingGatewayName: 'Model gateway setup',
    settingGatewayDesc: 'For public/community use: connect OpenAI, OpenRouter, LiteLLM, Ollama, or private gateways.',
    settingOpenWizard: 'Open setup wizard',
    settingShowNextLaunch: 'Show again on next launch',
    noticeSetupPromptRestored: 'First-run setup prompt restored',
    settingDefaultBackend: 'Default backend',
    settingDefaultBackendDesc: 'AI backend used by new chats',
    settingDefaultMode: 'Default mode',
    settingDefaultModeDesc: 'Run mode for new chats. Codex maps this to sandbox / bypass args.',
    settingCodexRepoMode: 'Codex workspace mode',
    settingCodexRepoModeDesc: 'Auto: use Git project mode when .git exists; otherwise allow local Vault mode. Git mode is stricter; local mode skips the Git repo check.',
    repoAuto: 'Auto detect',
    repoGit: 'Git project mode',
    repoLocal: 'Local Vault mode',
    backendFullTools: 'Full tool activity',
    backendTextStream: 'Text stream',
    settingCliPath: 'CLI path',
    settingCliPathDesc: 'Default `{defaultPath}`. Absolute paths are supported, e.g. /opt/homebrew/bin/{defaultPath}',
    cliPlaceholder: 'CLI command',
    settingDefaultModel: 'Default model',
    modelDescClaude: 'Example: claude-opus-4-7 / claude-sonnet-4-6',
    modelDescCodex: 'Example: gpt-5 / o4 / internal model name',
    modelDescOptional: 'Optional',
    modelPlaceholder: '(empty = default)',
    settingExtraArgs: 'Extra args',
    settingExtraArgsDesc: 'Additional CLI args, separated by spaces',
    settingGeneral: 'General',
    settingSessionsDir: 'Sessions folder (inside vault)',
    settingSessionsDirDesc: 'Conversations are saved here. Default: _shared/ai-sessions',
    settingAutoSave: 'Auto-save sessions',
    settingAutoSaveDesc: 'Write every conversation to a Markdown file in the vault. If disabled, chats are memory-only and disappear when the pane closes.',
    settingAttachmentsDir: 'Attachment folder (vault-relative)',
    settingShowThinking: 'Show Thinking blocks',
    settingShowThinkingDesc: 'Backends with structured thinking can show it, collapsed by default.',
    settingShowCost: 'Show cost / token usage',
    settingShowCostDesc: 'Display usage at the bottom after each turn',
    settingAutoCollapse: 'Collapse tool cards by default',
    settingAutoCollapseDesc: 'Keeps the chat compact; click a header to expand details.',
    settingCapabilities: 'Implemented capabilities',
    modalGatewayTitle: 'Model gateway setup',
    modalGatewayIntro: 'Use a Codex subscription login, or connect any OpenAI-compatible gateway with an API key.',
    modalConnectionMode: 'Connection mode',
    modalConnectionModeDesc: 'Subscription works with an existing Codex CLI login; API key works with OpenAI, OpenRouter, LiteLLM, Ollama, or private gateways.',
    modalSubscriptionOption: 'Subscription / Codex CLI login',
    modalApiOption: 'API key / model gateway',
    modalSubscriptionName: 'Subscription login',
    modalSubscriptionDesc: 'Use the account currently logged in through Codex CLI. If not logged in, run `codex login` in your terminal.',
    modalPreset: 'Provider preset',
    modalPresetDesc: 'Presets fill the base URL and recommended model; you can still edit them.',
    modalBaseUrl: 'API base URL',
    modalBaseUrlDesc: 'OpenAI-compatible base URL, e.g. https://api.openai.com/v1',
    modalModelName: 'Model name',
    modalModelNameDesc: 'Subscription mode may leave this empty; API mode should use a model exposed by the gateway.',
    modalWireApiDesc: 'Protocol used by Codex to talk to the gateway. Prefer responses; try chat if incompatible.',
    modalReasoning: 'Reasoning effort',
    modalReasoningDesc: 'Recommended default: high',
    modalRequiresKey: 'Requires API key',
    modalRequiresKeyDesc: 'Cloud gateways usually require this; local services like Ollama may not.',
    modalApiKeyDesc: 'Only used for this login. Open Bridge will not save it in plaintext.',
    modalApiKeyPlaceholder: 'Paste API key',
    modalLater: 'Later',
    modalSaveLogin: 'Save and log in',
    modalApiStatus: 'This will write ~/.codex/config.toml and use the API key to log Codex in.',
    modalSubStatus: 'This will switch to Codex CLI subscription mode and check local codex login status.',
    modalBaseUrlError: 'Enter a complete API base URL starting with http:// or https://.',
    modalModelError: 'Enter a model name.',
    modalApiKeyError: 'Enter an API key.',
    modalConfiguring: 'Configuring...',
    modalWriting: 'Writing Codex config and logging in...',
    modalLoginMayFail: 'Config was written, but Codex login returned an error. Use /doctor to check status.',
    noticeCodexLoginMayFail: 'Codex login may have failed. Run /doctor to check.',
    modalRetryLogin: 'Retry login',
    noticeGatewayReady: 'Model gateway configured',
    modalWritten: 'Wrote {path}. New chats default to Codex.',
    modalChecking: 'Checking...',
    modalCheckingSubscription: 'Saving subscription mode and checking Codex CLI login status.',
    modalSubscriptionNotLogged: 'Switched to subscription mode, but Codex may not be logged in. Run `codex login` in your terminal, then /doctor.',
    noticeRunCodexLogin: 'Run codex login in your system terminal first',
    modalRecheck: 'Recheck',
    noticeSubscriptionReady: 'Codex subscription mode enabled',
    modalSubscriptionWritten: 'Wrote {path}. New chats default to Codex CLI subscription.',
    modalSaveCheck: 'Save and check',
  },
  ja: {
    commandNewChat: '🤖 Open Bridge チャットを新規作成（新規ペイン）',
    commandRevealChat: '🤖 Open Bridge チャットを表示',
    commandCurrentPane: '🤖 現在のペインで Open Bridge を開く',
    commandPanel: '🤖 Open Bridge パネル',
    commandOpenSessions: '📁 AI sessions フォルダを開く',
    commandResumeSession: '🕐 AI セッションを再開（履歴から選択）',
    commandReload: '🔄 Open Bridge を再読み込み',
    commandSetupGateway: '🔌 モデルゲートウェイを設定',
    commandSetupCompanyGateway: '🏢 会社用 Codex ゲートウェイを設定（旧入口）',
    commandAddActiveFileContext: '📌 現在のファイルを Open Bridge コンテキストに追加',
    commandAddSelectionContext: '📌 選択範囲を Open Bridge コンテキストに追加',
    ribbonOpenNewChat: 'Open Bridge チャットを新規作成',
    menuAddFileContext: 'Open Bridge コンテキストに追加',
    menuAddSelectionContext: '選択範囲を Open Bridge コンテキストに追加',
    menuAddCurrentFileContext: '現在のファイルを Open Bridge コンテキストに追加',
    noticeNoActiveFile: '開いているファイルがありません',
    noticeCannotOpenPanel: 'Open Bridge パネルを開けません',
    noticeContextAdded: 'コンテキストに追加しました: {path}',
    noticeNoMarkdownFile: '開いている Markdown ファイルがありません',
    noticeSelectionAdded: '選択範囲を追加しました: {path}:{line}',
    noticeSessionsMissing: 'Sessions フォルダはまだありません: {dir}。最初の会話後に自動作成されます。',
    noticePluginReloadUnsupported: 'この Obsidian ではプラグイン内再読み込みに対応していません。手動で無効化して再度有効化してください。',
    noticeReloading: 'Open Bridge を再読み込みしています...',
    noticeReloadFailed: '再読み込みに失敗しました。手動で無効化して再度有効化してください: {message}',
    noticeLanguageChanged: '表示言語を切り替えました。新しい Open Bridge パネルに反映されます。',
    errorNoHome: 'ユーザーホームが見つからないため、Codex 設定を書き込めません。',
    statusReady: '準備完了',
    statusReadyCwd: '準備完了 · cwd = vault root',
    sessionNew: 'new session',
    figmaOff: '⚫ Figma off',
    figmaHint: 'クリック: /figma status\nダブルクリック: /figma connect',
    headerHistory: 'セッション履歴（MD から再開）',
    headerStop: '停止 (Esc)',
    headerNewSession: '新規チャット（新規 session）',
    headerMore: 'その他の操作',
    menuReload: 'Open Bridge を再読み込み',
    menuClear: '現在のチャットをクリア',
    menuGateway: 'モデルゲートウェイ接続',
    menuOpenSessions: 'Sessions フォルダを開く',
    modeLabel: 'AI',
    modeTitle: '実行モード',
    modelTitle: '設定を開いてモデルを変更',
    inputPlaceholder: 'Open Bridge に質問...（画像貼り付け / ファイル追加 / /help）',
    toolbarAttach: 'ファイルを添付',
    toolbarPin: '現在のファイルをコンテキストに追加',
    toolbarSlash: 'スラッシュコマンド',
    toolbarMic: '音声入力 (v0.6)',
    sendLabel: '送信 (Enter)、改行は Shift+Enter',
    welcomeTitle: '👋 Open Bridge v{version} · マルチバックエンド知識ワークスペース',
    welcomeLine: 'cwd = vault root。AI バックエンドは資産ファイルにアクセスできます。',
    welcomeFeaturesTitle: '✨ 主な機能',
    welcomeAskTitle: '💡 例として聞いてみる',
    welcomeHint: '💡 ヒント: スクリーンショット貼り付け / ファイルドロップで添付、/help でコマンド、➕ で新規 session',
    featureToolVisible: 'ツール実行をリアルタイム表示 (Read/Edit/Bash/Grep など)',
    featureDiff: 'ファイル diff をインライン表示',
    featureMultiTurn: '複数ターン会話（+ で新規 session、それ以外は自動再開）',
    featureModes: '4 モード: Default / Plan / Accept / Bypass',
    featureCost: 'Cost / Token 使用量を表示',
    examplePluginStatus: '.obsidian/plugins/ 以下のプラグイン状態を確認',
    exampleDesignTokens: '_shared/design-tokens/hanxue/DESIGN.md を読んで要約',
    exampleBrief: '_shared/templates/new-brief.md をもとに brief 例を作成',
    exampleTokenReview: 'designers/easiao/.../new-homepage/index.html の token 化率をレビュー',
    contextLabel: 'Context',
    contextHint: 'これらの項目は次のメッセージと一緒に AI へ送信されます',
    contextAIQuote: 'AI 引用',
    contextRemove: 'コンテキストを削除',
    contextClear: 'クリア',
    remove: '削除',
    modeDefaultDesc: '通常モード。ツール実行には承認が必要',
    modePlanDesc: '計画のみ。複雑な作業前の検討に使用',
    modeAcceptEditsDesc: 'ファイル編集は承認不要。Bash は承認が必要',
    modeBypassDesc: '⚠ すべてのツール実行で承認を省略',
    statusBackend: 'Backend: {backend} · {path}',
    statusMode: 'モード: {mode} · {desc}',
    statusNewSession: '🆕 新規 session',
    statusContextAdded: '📌 コンテキストに追加しました: {name}',
    settingIntro: '複数 AI Backend (Claude / Codex / Custom CLI) · backend ごとに個別設定',
    settingLanguageName: '表示言語',
    settingLanguageDesc: 'Open Bridge の表示言語を選択します。現在のチャットは保持され、新しいパネルに反映されます。',
    settingGatewayName: 'モデルゲートウェイ接続',
    settingGatewayDesc: 'コミュニティ公開向け: OpenAI、OpenRouter、LiteLLM、Ollama、企業ゲートウェイに接続できます。',
    settingOpenWizard: '設定ウィザードを開く',
    settingShowNextLaunch: '次回起動時に再表示',
    noticeSetupPromptRestored: '初回設定プロンプトを復元しました',
    settingDefaultBackend: '既定 Backend',
    settingDefaultBackendDesc: '新規 chat で使う AI backend',
    settingDefaultMode: '既定モード',
    settingDefaultModeDesc: '新規 chat の mode。Codex では sandbox / bypass 引数に変換されます。',
    settingCodexRepoMode: 'Codex 実行環境',
    settingCodexRepoModeDesc: 'Auto: .git があれば Git プロジェクト、なければローカル Vault を許可。Git モードは厳格で、ローカルモードは Git repo チェックをスキップします。',
    repoAuto: 'Auto 自動判定',
    repoGit: 'Git プロジェクトモード',
    repoLocal: 'ローカル Vault モード',
    backendFullTools: 'ツール実行を完全表示',
    backendTextStream: 'テキストストリーム',
    settingCliPath: 'CLI パス',
    settingCliPathDesc: '既定 `{defaultPath}`。/opt/homebrew/bin/{defaultPath} のような絶対パスも指定できます',
    cliPlaceholder: 'CLI コマンド',
    settingDefaultModel: '既定モデル',
    modelDescClaude: '例: claude-opus-4-7 / claude-sonnet-4-6',
    modelDescCodex: '例: gpt-5 / o4 / 社内 model name',
    modelDescOptional: '任意',
    modelPlaceholder: '（空 = 既定）',
    settingExtraArgs: '追加引数',
    settingExtraArgsDesc: 'CLI コマンドに追加する引数。スペース区切り',
    settingGeneral: '一般',
    settingSessionsDir: 'Sessions フォルダ（vault 内）',
    settingSessionsDirDesc: '各会話をここに自動保存します。既定 _shared/ai-sessions',
    settingAutoSave: 'Sessions を自動保存',
    settingAutoSaveDesc: '各会話を vault の Markdown ファイルに保存します。オフにするとメモリのみで、ペインを閉じると消えます。',
    settingAttachmentsDir: '添付ファイルフォルダ（vault 相対パス）',
    settingShowThinking: 'Thinking ブロックを表示',
    settingShowThinkingDesc: '構造化 thinking 対応 backend で表示します。既定は折りたたみ。',
    settingShowCost: 'Cost / Token 使用量を表示',
    settingShowCostDesc: '各ターン終了後に下部へ表示',
    settingAutoCollapse: 'ツールカードを既定で折りたたむ',
    settingAutoCollapseDesc: 'チャットをコンパクトに保ち、ヘッダークリックで詳細を開きます。',
    settingCapabilities: '実装済み機能',
    modalGatewayTitle: 'モデルゲートウェイ接続',
    modalGatewayIntro: 'Codex サブスクリプションログイン、または API Key で OpenAI-compatible ゲートウェイに接続できます。',
    modalConnectionMode: '接続方式',
    modalConnectionModeDesc: 'サブスクリプションは Codex CLI ログイン済みユーザー向け。API Key は OpenAI、OpenRouter、LiteLLM、Ollama、企業ゲートウェイ向けです。',
    modalSubscriptionOption: 'サブスクリプション / Codex CLI ログイン',
    modalApiOption: 'API Key / モデルゲートウェイ',
    modalSubscriptionName: 'サブスクリプションログイン',
    modalSubscriptionDesc: '現在 Codex CLI でログインしているアカウントを使います。未ログインの場合は端末で codex login を実行してください。',
    modalPreset: '接続プリセット',
    modalPresetDesc: 'プリセットは URL と推奨モデルを入力します。手動変更も可能です。',
    modalBaseUrl: 'API リクエスト URL',
    modalBaseUrlDesc: 'OpenAI-compatible Base URL。例: https://api.openai.com/v1',
    modalModelName: 'モデル名',
    modalModelNameDesc: 'サブスクリプションモードでは空欄可。API モードではゲートウェイが公開するモデル名を指定します。',
    modalWireApiDesc: 'Codex とゲートウェイの通信プロトコル。responses 優先、非対応なら chat を試してください。',
    modalReasoning: '推論強度',
    modalReasoningDesc: '既定 high 推奨',
    modalRequiresKey: 'API Key が必要',
    modalRequiresKeyDesc: 'クラウドゲートウェイは通常必要です。Ollama などローカルサービスでは不要な場合があります。',
    modalApiKeyDesc: '今回のログインにのみ使用します。プラグインは平文保存しません。',
    modalApiKeyPlaceholder: 'API Key を貼り付け',
    modalLater: '後で',
    modalSaveLogin: '保存してログイン',
    modalApiStatus: '保存後、ローカル ~/.codex/config.toml に書き込み、API Key で Codex ログインを実行します。',
    modalSubStatus: '保存後、Codex CLI サブスクリプションモードに切り替え、codex login 状態を確認します。',
    modalBaseUrlError: '完全な API リクエスト URL を入力してください。http:// または https:// で始まる必要があります。',
    modalModelError: 'モデル名を入力してください。',
    modalApiKeyError: 'API Key を入力してください。',
    modalConfiguring: '設定中...',
    modalWriting: 'Codex 設定を書き込み、ログインしています...',
    modalLoginMayFail: '設定ファイルは書き込みましたが、Codex ログインで異常が返りました。/doctor で確認してください。',
    noticeCodexLoginMayFail: 'Codex ログインに失敗した可能性があります。/doctor で確認してください。',
    modalRetryLogin: '再ログイン',
    noticeGatewayReady: 'モデルゲートウェイを設定しました',
    modalWritten: '{path} に書き込みました。新規チャットは Codex を既定で使用します。',
    modalChecking: '確認中...',
    modalCheckingSubscription: 'サブスクリプションモードを保存し、Codex CLI ログイン状態を確認しています。',
    modalSubscriptionNotLogged: 'サブスクリプションモードに切り替えましたが、Codex が未ログインの可能性があります。端末で codex login を実行し、/doctor で確認してください。',
    noticeRunCodexLogin: '先にシステム端末で codex login を実行してください',
    modalRecheck: '再確認',
    noticeSubscriptionReady: 'Codex サブスクリプションモードを有効化しました',
    modalSubscriptionWritten: '{path} に書き込みました。新規チャットは Codex CLI サブスクリプションを既定で使用します。',
    modalSaveCheck: '保存して確認',
  },
};

function normalizeLanguage(value) {
  return LANGUAGE_OPTIONS[value] ? value : 'zh';
}

function tFor(lang, key, vars = {}) {
  const table = I18N[normalizeLanguage(lang)] || I18N.zh;
  const text = table[key] ?? I18N.zh[key] ?? key;
  return String(text).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
}

const DEFAULT_SETTINGS = {
  uiLanguage: 'zh',

  // 默认 backend (启动新 chat 时)
  defaultBackend: 'claude',         // 'claude' | 'codex' | 'custom'

  // Backend 配置 (每个 backend 独立)
  backends: {
    claude: {
      path: 'claude',
      model: '',                    // 空 = backend 默认
      extraArgs: '',
    },
    codex: {
      path: 'codex',
      model: '',
      extraArgs: '--sandbox workspace-write',
    },
    custom: {
      path: '',
      model: '',
      extraArgs: '',
      label: 'Custom',
    },
  },

  defaultMode: 'default',
  codexRepoMode: 'auto',            // auto | git | local
  modelGatewaySetupDismissed: false,
  modelGatewayConnectionMode: 'api',
  modelGatewayPreset: 'custom',
  modelGatewayBaseUrl: '',
  modelGatewayModel: '',
  modelGatewayReasoning: 'high',
  modelGatewayWireApi: 'responses',
  modelGatewayRequiresAuth: true,
  attachmentsDir: '_shared/temp-claude-attachments',
  sessionsDir: SESSIONS_DIR,
  autoSaveSessions: true,
  showThinking: true,
  showCost: true,
  autoCollapseToolBody: true,

  // 老字段保留兼容
  claudePath: 'claude',
  model: '',
};

// ─── Backend 定义 ────────────────────────────────────────────────
// 每个 backend 描述: 怎么 spawn / 怎么解析输出
const BACKENDS = {
  claude: {
    id: 'claude',
    label: 'Claude',
    icon: 'sparkles',
    defaultPath: 'claude',
    streamFormat: 'claude-json',
    supportsResume: true,
    supportsModes: true,
    buildArgs(prompt, opts) {
      const args = [
        '--print',
        '--output-format', 'stream-json',
        '--input-format', 'text',
        '--verbose',
      ];
      if (opts.mode === 'bypass') {
        args.push('--dangerously-skip-permissions');
      } else if (opts.mode === 'plan') {
        args.push('--permission-mode', 'plan');
      } else if (opts.mode === 'acceptEdits') {
        args.push('--permission-mode', 'acceptEdits');
      }
      if (opts.sessionId) args.push('--resume', opts.sessionId);
      if (opts.model) args.push('--model', opts.model);
      if (opts.extraArgs) args.push(...opts.extraArgs.split(/\s+/).filter(Boolean));
      args.push(prompt);
      return args;
    },
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    icon: 'code',
    defaultPath: 'codex',
    streamFormat: 'codex-json',
    promptStdin: true,
    supportsResume: false,           // codex 多轮机制 v0.6 再接
    supportsModes: true,
    buildArgs(prompt, opts) {
      const args = ['exec', '--json', '--color', 'never'];
      if (opts.skipGitRepoCheck) args.push('--skip-git-repo-check');
      // Codex 0.130+: 旧全自动参数已过时。默认用 workspace-write, Bypass 才跳过审批和沙箱。
      if (opts.mode === 'bypass') {
        args.push('--dangerously-bypass-approvals-and-sandbox');
      } else if (!opts.extraArgs || !/\s--sandbox\s+/.test(` ${opts.extraArgs} `)) {
        args.push('--sandbox', opts.mode === 'plan' ? 'read-only' : 'workspace-write');
      }
      if (opts.model) args.push('--model', opts.model);
      if (opts.extraArgs) args.push(...opts.extraArgs.split(/\s+/).filter(Boolean));
      args.push('-');
      return args;
    },
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    icon: 'terminal',
    defaultPath: '',
    streamFormat: 'text',
    supportsResume: false,
    supportsModes: false,
    buildArgs(prompt, opts) {
      const args = [];
      if (opts.extraArgs) args.push(...opts.extraArgs.split(/\s+/).filter(Boolean));
      args.push(prompt);
      return args;
    },
  },
};

const PERMISSION_MODES = {
  'default':     { label: 'Default',     desc: '正常模式, 工具调用要求权限',           icon: 'circle' },
  'plan':        { label: 'Plan',        desc: '只规划不执行, 用于复杂任务先讨论',     icon: 'brain' },
  'acceptEdits': { label: 'Accept Edits', desc: '文件编辑免审批, Bash 仍需审批',       icon: 'pencil' },
  'bypass':      { label: 'Bypass',      desc: '⚠ 所有工具调用免审批, 自治执行',       icon: 'zap' },
};

const SLASH_HELP = `**斜杠命令:**
- \`/help\` \`/?\` — 显示帮助
- \`/clear\` — 清空对话 (并新开 session)
- \`/cwd\` — 显示工作目录
- \`/version\` — 当前 Backend CLI 版本
- \`/doctor\` — 检查当前 Backend 是否可用 / 是否登录
- \`/login\` — 显示当前 Backend 的登录方式
- \`/setup\` — 打开模型网关接入向导
- \`/scan\` — 本地快速扫描当前 Vault 目录结构
- \`/model <name>\` — 切换模型
- \`/mode <name>\` — 切换模式 (default/plan/acceptEdits/bypass)
- \`/session\` — 显示当前 session_id
- \`/resume\` — 恢复历史 session (跟 --resume 一样)

**模式说明:**
- **Default**: 默认, 工具调用要求权限
- **Plan**: 只规划不执行, 用于复杂任务先讨论
- **Accept Edits**: 文件编辑免审批 (Bash 仍需审批)
- **Bypass**: ⚠ 全部免审批, 自治执行 (--dangerously-skip-permissions)

**附件:**
- 粘贴图片 (Cmd+V) 或拖拽文件到输入区
- 自动保存到 \`${DEFAULT_SETTINGS.attachmentsDir}/\`

**Figma Bridge:**
- \`/figma\` — 显示 Figma Bridge 帮助
- \`/figma status\` — 检查 WebSocket (port 3055) + Figma 进程
- \`/figma connect\` — 一键启动: 拉起 WebSocket + Figma + 提示连接
- \`/figma stop\` — 停掉 WebSocket 服务

**快捷键:**
- \`Enter\` 发送，\`Shift+Enter\` 换行
- \`Esc\` 中断
- \`Cmd+L\` 清空 (输入框聚焦时)`;

const FIGMA_HELP = `**🌉 Figma Bridge · MCP 远程模式**

让 Open Bridge 中的 Claude / Codex 通过 MCP 远程操作 Figma 桌面端,
不用发布插件, 桌面端 Development 模式即可。

**架构:**
\`\`\`
Claude / Codex CLI → MCP figma-edit → WebSocket (port 3055) → Figma Desktop (Claude DesignER)
\`\`\`

**命令:**
- \`/figma status\` — 查 WebSocket 端口 + Figma 进程状态
- \`/figma connect\` — 一键拉起服务 (新 Terminal 跑 Bun WebSocket + 启动 Figma)
- \`/figma stop\` — 杀掉 WebSocket
- \`/figma\` — 显示本帮助

**手动 3 步 (如果脚本失败):**
1. 终端跑: \`bash _scripts/start-figma-bridge.sh\`
2. Figma Desktop → Plugins → Development → Claude DesignER
3. 输入 Channel ID, 点 Connect

之后跟 AI 说: "用 figma-edit MCP get_document_info 看 Figma 文件结构"
`;

// ═════════════════════════════════════════════════════════════
// Plugin
// ═════════════════════════════════════════════════════════════

class ClaudeBridgePlugin extends obsidian.Plugin {
  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_CLAUDE_BRIDGE, (leaf) => new ClaudeBridgeView(leaf, this));

    this.addRibbonIcon('bot', this.t('ribbonOpenNewChat'), () => this.openNewChat());

    this.addCommand({ id: 'new-open-bridge-chat',      name: this.t('commandNewChat'),       callback: () => this.openNewChat() });
    this.addCommand({ id: 'reveal-open-bridge-chat',   name: this.t('commandRevealChat'),    callback: () => this.revealExisting() });
    this.addCommand({ id: 'open-bridge-current-pane',  name: this.t('commandCurrentPane'),   callback: () => this.openInCurrentPane() });
    this.addCommand({ id: 'open-bridge-panel',         name: this.t('commandPanel'),         callback: () => this.openNewChat() });
    this.addCommand({
      id: 'open-sessions-folder',
      name: this.t('commandOpenSessions'),
      callback: () => this.openSessionsFolder()
    });
    this.addCommand({
      id: 'resume-session',
      name: this.t('commandResumeSession'),
      callback: () => this.openSessionPicker()
    });
    this.addCommand({
      id: 'reload-ai-bridge',
      name: this.t('commandReload'),
      callback: () => this.reloadSelf()
    });
    this.addCommand({
      id: 'setup-model-gateway',
      name: this.t('commandSetupGateway'),
      callback: () => this.openModelGatewaySetup()
    });
    this.addCommand({
      id: 'setup-company-codex',
      name: this.t('commandSetupCompanyGateway'),
      callback: () => this.openModelGatewaySetup()
    });
    this.addCommand({
      id: 'add-active-file-to-open-bridge-context',
      name: this.t('commandAddActiveFileContext'),
      callback: () => this.addActiveFileToBridgeContext()
    });
    this.addCommand({
      id: 'add-selection-to-open-bridge-context',
      name: this.t('commandAddSelectionContext'),
      editorCallback: (editor, view) => this.addEditorSelectionToBridgeContext(editor, view)
    });

    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!file) return;
      menu.addItem(item => item
        .setTitle(this.t('menuAddFileContext'))
        .setIcon(file.children ? 'folder-input' : 'file-plus')
        .onClick(() => this.addFileToBridgeContext(file)));
    }));

    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
      menu.addItem(item => item
        .setTitle(editor?.getSelection?.() ? this.t('menuAddSelectionContext') : this.t('menuAddCurrentFileContext'))
        .setIcon('message-square-plus')
        .onClick(() => this.addEditorSelectionToBridgeContext(editor, view)));
    }));

    this.addSettingTab(new ClaudeBridgeSettingTab(this.app, this));

    setTimeout(() => this.maybeOpenModelGatewaySetup(), 900);

    console.log('[' + APP_NAME + '] v' + PLUGIN_VERSION + ' loaded');
  }

  onunload() { console.log('[' + APP_NAME + '] unloaded'); }

  t(key, vars = {}) {
    return tFor(this.settings?.uiLanguage, key, vars);
  }

  getModeDesc(mode) {
    const key = {
      default: 'modeDefaultDesc',
      plan: 'modePlanDesc',
      acceptEdits: 'modeAcceptEditsDesc',
      bypass: 'modeBypassDesc',
    }[mode];
    return key ? this.t(key) : (PERMISSION_MODES[mode]?.desc || '');
  }

  getRepoModeLabel(mode) {
    const key = { auto: 'repoAuto', git: 'repoGit', local: 'repoLocal' }[mode];
    return key ? this.t(key) : (CODEX_REPO_MODES[mode] || mode);
  }

  async openNewChat() {
    const leaf = this.app.workspace.getLeaf('split', 'vertical');
    await leaf.setViewState({ type: VIEW_TYPE_CLAUDE_BRIDGE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async revealExisting() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_BRIDGE);
    if (leaves.length > 0) this.app.workspace.revealLeaf(leaves[0]);
    else await this.openNewChat();
  }

  async openInCurrentPane() {
    const leaf = this.app.workspace.getMostRecentLeaf() || this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_CLAUDE_BRIDGE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async getBridgeView(createIfMissing = true) {
    const active = this.app.workspace.activeLeaf?.view;
    if (active && active.getViewType?.() === VIEW_TYPE_CLAUDE_BRIDGE) return active;

    let leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_BRIDGE);
    if (leaves.length > 0) {
      await this.app.workspace.revealLeaf(leaves[0]);
      return leaves[0].view;
    }

    if (!createIfMissing) return null;
    await this.openNewChat();
    leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_BRIDGE);
    return leaves[0]?.view || null;
  }

  async addActiveFileToBridgeContext() {
    const file = this.app.workspace.getActiveFile?.();
    if (!file) {
      new obsidian.Notice(this.t('noticeNoActiveFile'));
      return;
    }
    await this.addFileToBridgeContext(file);
  }

  async addFileToBridgeContext(file) {
    const view = await this.getBridgeView(true);
    if (!view?.addContextItem) {
      new obsidian.Notice(this.t('noticeCannotOpenPanel'));
      return;
    }

    const isFolder = !!file.children;
    view.addContextItem({
      type: isFolder ? 'folder' : 'file',
      path: file.path,
      name: file.name || file.path,
      addedAt: Date.now()
    });
    new obsidian.Notice(this.t('noticeContextAdded', { path: file.path }));
  }

  async addEditorSelectionToBridgeContext(editor, markdownView) {
    const file = markdownView?.file || this.app.workspace.getActiveFile?.();
    if (!file) {
      new obsidian.Notice(this.t('noticeNoMarkdownFile'));
      return;
    }

    const selected = editor?.getSelection?.() || '';
    if (!selected.trim()) {
      await this.addFileToBridgeContext(file);
      return;
    }

    const from = editor.getCursor?.('from') || { line: 0, ch: 0 };
    const to = editor.getCursor?.('to') || from;
    const around = this.getEditorSurroundingText(editor, from.line, to.line, 3);
    const view = await this.getBridgeView(true);
    if (!view?.addContextItem) {
      new obsidian.Notice(this.t('noticeCannotOpenPanel'));
      return;
    }
    view.addContextItem({
      type: 'selection',
      path: file.path,
      name: file.name || file.path,
      startLine: from.line + 1,
      endLine: to.line + 1,
      selectedText: selected,
      surroundingText: around,
      addedAt: Date.now()
    });
    new obsidian.Notice(this.t('noticeSelectionAdded', { path: file.path, line: from.line + 1 }));
  }

  getEditorSurroundingText(editor, fromLine, toLine, radius = 3) {
    if (!editor?.lineCount || !editor?.getLine) return '';
    const start = Math.max(0, fromLine - radius);
    const end = Math.min(editor.lineCount() - 1, toLine + radius);
    const lines = [];
    for (let i = start; i <= end; i++) {
      lines.push(`${i + 1}: ${editor.getLine(i) || ''}`);
    }
    return lines.join('\n');
  }

  async openSessionsFolder() {
    const dir = this.settings.sessionsDir || SESSIONS_DIR;
    const folder = this.app.vault.getAbstractFileByPath(dir);
    if (!folder) {
      new obsidian.Notice(this.t('noticeSessionsMissing', { dir }));
      return;
    }
    // 触发文件树定位
    const fileExplorer = this.app.workspace.getLeavesOfType('file-explorer')[0];
    if (fileExplorer) {
      this.app.workspace.revealLeaf(fileExplorer);
      // 滚到该目录
      const tree = fileExplorer.view;
      if (tree && tree.revealInFolder) tree.revealInFolder(folder);
    }
    new obsidian.Notice(`📁 ${dir}`);
  }

  // v0.8: 打开历史 session 选择器
  async openSessionPicker() {
    // 找当前的 Open Bridge view
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_BRIDGE);
    let view = null;
    if (leaves.length > 0) {
      // 优先用 active leaf 里的 view
      const activeLeaf = this.app.workspace.activeLeaf;
      const activeView = activeLeaf?.view;
      if (activeView && activeView.getViewType?.() === VIEW_TYPE_CLAUDE_BRIDGE) {
        view = activeView;
      } else {
        view = leaves[0].view;
      }
    } else {
      // 没开 → 开一个新的, 然后再选
      await this.openNewChat();
      const newLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_BRIDGE);
      if (newLeaves.length > 0) view = newLeaves[0].view;
    }

    if (!view) {
      new obsidian.Notice(`无法定位 ${APP_NAME} view`);
      return;
    }

    new SessionPickerModal(this.app, this, view).open();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.uiLanguage = normalizeLanguage(this.settings.uiLanguage);
  }

  async saveSettings() { await this.saveData(this.settings); }

  async reloadSelf() {
    const id = this.manifest?.id || 'open-bridge';
    const plugins = this.app.plugins;
    if (!plugins?.disablePlugin || !plugins?.enablePlugin) {
      new obsidian.Notice(this.t('noticePluginReloadUnsupported'));
      return;
    }
    new obsidian.Notice(this.t('noticeReloading'));
    setTimeout(async () => {
      try {
        await plugins.disablePlugin(id);
        await plugins.enablePlugin(id);
      } catch (e) {
        new obsidian.Notice(this.t('noticeReloadFailed', { message: e.message }));
      }
    }, 80);
  }

  openModelGatewaySetup() {
    new ModelGatewaySetupModal(this.app, this, { force: true }).open();
  }

  openCompanyCodexSetup() {
    this.openModelGatewaySetup();
  }

  async maybeOpenModelGatewaySetup() {
    try {
      if (this.settings.modelGatewaySetupDismissed ?? this.settings.companyCodexSetupDismissed) return;
      if (this.hasModelGatewayConfig()) return;
      new ModelGatewaySetupModal(this.app, this).open();
    } catch (e) {
      console.warn('[' + APP_NAME + '] model gateway setup check failed', e);
    }
  }

  getCodexHome() {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return home ? path.join(home, '.codex') : '';
  }

  getCodexConfigPath() {
    const home = this.getCodexHome();
    return home ? path.join(home, 'config.toml') : '';
  }

  hasModelGatewayConfig() {
    const configPath = this.getCodexConfigPath();
    if (!configPath || !fs.existsSync(configPath)) return false;
    const text = fs.readFileSync(configPath, 'utf8');
    return /model_provider\s*=\s*["']custom["']/.test(text) &&
      /\[model_providers\.custom\]/.test(text) &&
      /base_url\s*=/.test(text);
  }

  async configureModelGateway({ providerId, baseUrl, model, reasoning, wireApi, requiresAuth, apiKey }) {
    const codexCfg = this.settings.backends?.codex || {};
    const cliPath = codexCfg.path || 'codex';
    const codexHome = this.getCodexHome();
    const configPath = this.getCodexConfigPath();
    if (!codexHome || !configPath) throw new Error(this.t('errorNoHome'));

    await fs.promises.mkdir(codexHome, { recursive: true });
    await this.writeModelGatewayConfig(configPath, { baseUrl, model, reasoning, wireApi, requiresAuth });

    if (!this.settings.backends) this.settings.backends = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.backends));
    if (!this.settings.backends.codex) this.settings.backends.codex = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.backends.codex));
    this.settings.backends.codex.model = model;
    this.settings.defaultBackend = 'codex';
    this.settings.codexRepoMode = this.settings.codexRepoMode || 'auto';
    this.settings.modelGatewayPreset = providerId || 'custom';
    this.settings.modelGatewayBaseUrl = baseUrl;
    this.settings.modelGatewayModel = model;
    this.settings.modelGatewayReasoning = reasoning;
    this.settings.modelGatewayWireApi = wireApi || 'responses';
    this.settings.modelGatewayRequiresAuth = requiresAuth !== false;
    this.settings.modelGatewaySetupDismissed = true;
    this.settings.companyCodexSetupDismissed = true;
    await this.saveSettings();

    const loginOut = requiresAuth === false
      ? 'auth skipped\nexit code: 0'
      : await this.spawnAndCaptureWithInput(cliPath, ['login', '--with-api-key'], apiKey + '\n', { timeoutMs: 30000 });
    return { configPath, loginOut };
  }

  async configureCodexSubscription({ model, reasoning }) {
    const codexCfg = this.settings.backends?.codex || {};
    const cliPath = codexCfg.path || 'codex';
    const codexHome = this.getCodexHome();
    const configPath = this.getCodexConfigPath();
    if (!codexHome || !configPath) throw new Error(this.t('errorNoHome'));

    await fs.promises.mkdir(codexHome, { recursive: true });
    await this.writeCodexSubscriptionConfig(configPath, { model, reasoning });

    if (!this.settings.backends) this.settings.backends = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.backends));
    if (!this.settings.backends.codex) this.settings.backends.codex = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.backends.codex));
    this.settings.backends.codex.model = model || '';
    this.settings.defaultBackend = 'codex';
    this.settings.codexRepoMode = this.settings.codexRepoMode || 'auto';
    this.settings.modelGatewayConnectionMode = 'subscription';
    this.settings.modelGatewayModel = model || '';
    this.settings.modelGatewayReasoning = reasoning || 'high';
    this.settings.modelGatewaySetupDismissed = true;
    this.settings.companyCodexSetupDismissed = true;
    await this.saveSettings();

    const loginOut = await this.spawnAndCapture(cliPath, ['login', 'status'], { timeoutMs: 10000 });
    return { configPath, loginOut };
  }

  async writeCodexSubscriptionConfig(configPath, { model, reasoning }) {
    let existing = '';
    try { existing = await fs.promises.readFile(configPath, 'utf8'); } catch (e) { existing = ''; }

    let rest = this.removeTopLevelCodexKeys(existing)
      .replace(/\[model_providers\.custom\][\s\S]*?(?=\n\[[^\]]+\]|\s*$)/m, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const lines = [];
    if (model) lines.push(`model = "${this.escapeTomlString(model)}"`);
    if (reasoning) lines.push(`model_reasoning_effort = "${this.escapeTomlString(reasoning)}"`);
    lines.push('disable_response_storage = true');

    const block = lines.join('\n');
    const next = rest ? `${block}\n\n${rest}\n` : `${block}\n`;
    await fs.promises.writeFile(configPath, next, 'utf8');
  }

  async writeModelGatewayConfig(configPath, { baseUrl, model, reasoning, wireApi, requiresAuth }) {
    let existing = '';
    try { existing = await fs.promises.readFile(configPath, 'utf8'); } catch (e) { existing = ''; }

    let rest = this.removeTopLevelCodexKeys(existing)
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    rest = rest.replace(/\[model_providers\.custom\][\s\S]*?(?=\n\[[^\]]+\]|\s*$)/m, '').trim();

    const block = [
      'model_provider = "custom"',
      `model = "${this.escapeTomlString(model)}"`,
      `model_reasoning_effort = "${this.escapeTomlString(reasoning)}"`,
      'disable_response_storage = true',
      '',
      '[model_providers.custom]',
      'name = "custom"',
      `base_url = "${this.escapeTomlString(baseUrl)}"`,
      `wire_api = "${this.escapeTomlString(wireApi || 'responses')}"`,
      `requires_openai_auth = ${requiresAuth === false ? 'false' : 'true'}`,
    ].join('\n');

    const next = rest ? `${block}\n\n${rest}\n` : `${block}\n`;
    await fs.promises.writeFile(configPath, next, 'utf8');
  }

  removeTopLevelCodexKeys(text) {
    const keys = new Set(['model_provider', 'model', 'model_reasoning_effort', 'disable_response_storage']);
    let inSection = false;
    return String(text || '').split('\n').filter(line => {
      if (/^\s*\[[^\]]+\]\s*$/.test(line)) inSection = true;
      if (inSection) return true;
      const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*=/);
      return !match || !keys.has(match[1]);
    }).join('\n');
  }

  escapeTomlString(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  async spawnAndCaptureWithInput(cmd, args, input, options = {}) {
    return new Promise((resolve) => {
      try {
        const enhancedPath = [process.env.PATH || '', '/usr/local/bin', '/opt/homebrew/bin'].filter(Boolean).join(':');
        const p = spawn(cmd, args, { env: { ...process.env, PATH: enhancedPath }, shell: false });
        let out = '';
        const timeoutMs = options.timeoutMs || 30000;
        const timer = setTimeout(() => {
          try { p.kill('SIGTERM'); } catch (e) { /* noop */ }
          resolve((out || '') + `\nerror: command timed out after ${Math.round(timeoutMs / 1000)}s`);
        }, timeoutMs);
        p.stdout.on('data', c => out += c.toString());
        p.stderr.on('data', c => out += c.toString());
        p.on('close', code => { clearTimeout(timer); resolve((out || '') + `\nexit code: ${code}`); });
        p.on('error', e => { clearTimeout(timer); resolve(`error: ${e.message}`); });
        if (input) p.stdin.end(input);
        else p.stdin.end();
      } catch (e) { resolve(`error: ${e.message}`); }
    });
  }
}

// ═════════════════════════════════════════════════════════════
// View · 聊天面板
// ═════════════════════════════════════════════════════════════

class ClaudeBridgeView extends obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;

    // 状态
    this.messages = [];
    this.attachments = [];
    this.contextItems = [];
    this.isRunning = false;
    this.currentProcess = null;
    this.sessionId = null;          // 后端持久 session id (Claude)
    this.currentMode = plugin.settings.defaultMode || 'default';
    this.currentBackend = plugin.settings.defaultBackend || 'claude';
    this.toolCards = new Map();     // tool_use_id → card 元素
    this.lastCost = null;

    // v0.6 history & 持久化
    this.startedAt = Date.now();
    this.sessionFile = null;        // 保存到 vault 的相对路径
    this.currentTurn = null;        // 当前 assistant turn 的累积 (text + tool_calls)

    // DOM
    this.headerSessionEl = null;
    this.modeSelectorEl = null;
    this.backendSelectorEl = null;
    this.modelDisplayEl = null;
    this.messagesContainer = null;
    this.inputEl = null;
    this.contextBar = null;
    this.attachmentsBar = null;
    this.statusEl = null;
    this.costBarEl = null;
  }

  getViewType() { return VIEW_TYPE_CLAUDE_BRIDGE; }
  getDisplayText() { return APP_NAME; }
  getIcon() { return 'bot'; }
  t(key, vars = {}) { return this.plugin.t(key, vars); }

  // ─── UI 构建 ─────────────────────────────────────────────

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('open-bridge-container');

    this.buildHeader(container);
    this.buildModeBar(container);
    this.buildStatus(container);
    this.buildMessages(container);
    this.buildCostBar(container);
    this.buildInputArea(container);
    this.renderWelcome();
  }

  async onClose() {
    this.stopCurrent();
    if (this.figmaStatusTimer) {
      clearInterval(this.figmaStatusTimer);
      this.figmaStatusTimer = null;
    }
  }

  buildHeader(container) {
    const header = container.createDiv({ cls: 'cb-header' });

    const left = header.createDiv({ cls: 'cb-header-left' });
    const title = left.createDiv({ cls: 'cb-header-title' });
    title.createSpan({ text: '🤖', cls: 'cb-header-icon' });
    title.createSpan({ text: 'Open Bridge', cls: 'cb-header-text' });
    title.createSpan({ text: 'v' + PLUGIN_VERSION, cls: 'cb-header-version' });

    this.statusEl = left.createDiv({ cls: 'cb-status-inline', text: this.t('statusReady') });
    this.headerSessionEl = left.createSpan({ cls: 'cb-session-dot', text: '•' });
    this.headerSessionEl.title = this.t('sessionNew');
    this.savedIndicatorEl = left.createDiv({ cls: 'cb-saved-indicator cb-hidden' });

    // Figma Bridge 指示灯
    this.figmaIndicatorEl = header.createDiv({ cls: 'cb-figma-indicator', text: this.t('figmaOff') });
    this.figmaIndicatorEl.title = this.t('figmaHint');
    let clickTimer = null;
    this.figmaIndicatorEl.onclick = () => {
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
        this.handleSlash('/figma connect');
      } else {
        clickTimer = setTimeout(() => {
          clickTimer = null;
          this.handleSlash('/figma status');
        }, 250);
      }
    };
    // 启动时立即检测 + 周期刷新
    this.refreshFigmaIndicator();
    this.figmaStatusTimer = setInterval(() => this.refreshFigmaIndicator(), FIGMA_STATUS_REFRESH_MS);

    const controls = header.createDiv({ cls: 'cb-header-controls' });
    this.makeIconButton(controls, 'history',  this.t('headerHistory'), () => this.plugin.openSessionPicker());
    this.makeIconButton(controls, 'square',   this.t('headerStop'),    () => this.stopCurrent());
    this.makeIconButton(controls, 'plus',     this.t('headerNewSession'), () => this.newSession());
    this.makeIconButton(controls, 'more-horizontal', this.t('headerMore'), (e) => this.openHeaderMenu(e));
  }

  openHeaderMenu(event) {
    const menu = new obsidian.Menu();
    menu.addItem(item => item
      .setTitle(this.t('menuReload'))
      .setIcon('refresh-cw')
      .onClick(() => this.plugin.reloadSelf()));
    menu.addItem(item => item
      .setTitle(this.t('menuClear'))
      .setIcon('trash-2')
      .onClick(() => this.clearMessages()));
    menu.addItem(item => item
      .setTitle(this.t('menuGateway'))
      .setIcon('plug')
      .onClick(() => this.plugin.openModelGatewaySetup()));
    menu.addItem(item => item
      .setTitle(this.t('menuOpenSessions'))
      .setIcon('folder-open')
      .onClick(() => this.plugin.openSessionsFolder()));
    if (event?.clientX != null) menu.showAtMouseEvent(event);
    else menu.showAtPosition({ x: window.innerWidth - 28, y: 52 });
  }

  buildModeBar(container) {
    const bar = container.createDiv({ cls: 'cb-mode-bar' });

    // ── 左侧: Backend / Mode 紧凑选择 ───────────────────
    const modeWrap = bar.createDiv({ cls: 'cb-mode-bar-left' });
    modeWrap.createSpan({ cls: 'cb-mode-label', text: this.t('modeLabel') });

    this.backendSelectorEl = modeWrap.createEl('select', { cls: 'cb-compact-select cb-backend-selector' });
    for (const [key, info] of Object.entries(BACKENDS)) {
      this.backendSelectorEl.createEl('option', { text: info.label, value: key });
    }
    this.backendSelectorEl.value = this.currentBackend;
    this.backendSelectorEl.onchange = () => this.setBackend(this.backendSelectorEl.value);

    this.modeSelectorEl = modeWrap.createEl('select', { cls: 'cb-compact-select cb-mode-selector' });
    for (const [key, info] of Object.entries(PERMISSION_MODES)) {
      this.modeSelectorEl.createEl('option', { text: info.label, value: key });
    }
    this.modeSelectorEl.value = this.currentMode;
    this.modeSelectorEl.title = this.t('modeTitle');
    this.modeSelectorEl.onchange = () => this.setMode(this.modeSelectorEl.value);

    // ── 右侧: Model / Session ───────────────────────────
    const rightWrap = bar.createDiv({ cls: 'cb-mode-bar-right' });

    // 模型显示
    this.modelDisplayEl = rightWrap.createSpan({ cls: 'cb-model-display' });
    obsidian.setIcon(this.modelDisplayEl.createSpan({ cls: 'cb-model-icon' }), 'cpu');
    this.modelDisplayEl.createSpan({ cls: 'cb-model-name', text: this.getCurrentModel() || 'default' });
    this.modelDisplayEl.title = this.t('modelTitle');
    this.modelDisplayEl.onclick = () => this.app.setting.open();
  }

  getCurrentBackendConfig() {
    return this.plugin.settings.backends?.[this.currentBackend]
      || { path: BACKENDS[this.currentBackend]?.defaultPath || this.currentBackend, model: '', extraArgs: '' };
  }

  getCurrentModel() {
    return this.getCurrentBackendConfig().model || '';
  }

  setBackend(key) {
    if (!BACKENDS[key]) return;
    this.currentBackend = key;
    if (this.backendSelectorEl && this.backendSelectorEl.tagName === 'SELECT') this.backendSelectorEl.value = key;
    this.backendSelectorEl?.querySelectorAll?.('.cb-backend-btn').forEach(btn => {
      btn.toggleClass('cb-backend-active', btn.getAttribute('data-backend') === key);
    });
    this.refreshModelDisplay();
    const info = BACKENDS[key];
    this.updateStatus(this.t('statusBackend', { backend: info.label, path: this.getCurrentBackendConfig().path || info.defaultPath }));
    // 切 backend 新开 session (不同 backend session id 不通用)
    this.sessionId = null;
    if (this.headerSessionEl) {
      this.headerSessionEl.setText('•');
      this.headerSessionEl.title = this.t('sessionNew');
    }
  }

  refreshModelDisplay() {
    const nameEl = this.modelDisplayEl?.querySelector('.cb-model-name');
    if (nameEl) nameEl.setText(this.getCurrentModel() || 'default');
  }

  buildStatus(container) {
    if (this.statusEl) {
      this.updateStatus(this.t('statusReady'));
      return;
    }
    this.statusEl = container.createDiv({ cls: 'cb-status' });
    this.updateStatus(this.t('statusReadyCwd'));
  }

  buildMessages(container) {
    this.messagesContainer = container.createDiv({ cls: 'cb-messages' });
  }

  buildCostBar(container) {
    this.costBarEl = container.createDiv({ cls: 'cb-cost-bar cb-hidden' });
  }

  buildInputArea(container) {
    const inputArea = container.createDiv({ cls: 'cb-input-area' });
    const inputBox = inputArea.createDiv({ cls: 'cb-input-box' });

    this.contextBar = inputBox.createDiv({ cls: 'cb-context-bar cb-hidden' });
    this.attachmentsBar = inputBox.createDiv({ cls: 'cb-attachments-bar cb-hidden' });

    this.inputEl = inputBox.createEl('textarea', {
      cls: 'cb-input',
      attr: {
        placeholder: this.t('inputPlaceholder'),
        rows: '3'
      }
    });

    const toolbar = inputBox.createDiv({ cls: 'cb-toolbar' });
    const tlLeft = toolbar.createDiv({ cls: 'cb-toolbar-left' });
    this.makeToolbarButton(tlLeft, 'paperclip', this.t('toolbarAttach'), () => this.openFilePicker());
    this.makeToolbarButton(tlLeft, 'pin',       this.t('toolbarPin'),    () => this.plugin.addActiveFileToBridgeContext());
    this.makeToolbarButton(tlLeft, 'slash',     this.t('toolbarSlash'),  () => this.openSlashHelp());
    this.makeToolbarButton(tlLeft, 'mic',       this.t('toolbarMic'),    () => this.notImplementedYet(this.t('toolbarMic')));

    const tlRight = toolbar.createDiv({ cls: 'cb-toolbar-right' });
    const sendBtn = tlRight.createEl('button', { cls: 'cb-send-btn', attr: { 'aria-label': this.t('sendLabel') } });
    obsidian.setIcon(sendBtn, 'arrow-up');
    sendBtn.onclick = () => this.sendMessage();

    // 事件
    let isComposing = false;
    let justComposedAt = 0;
    this.inputEl.addEventListener('compositionstart', () => { isComposing = true; });
    this.inputEl.addEventListener('compositionend', () => {
      isComposing = false;
      justComposedAt = Date.now();
    });
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        if (isComposing || e.isComposing || Date.now() - justComposedAt < 120) return;
        e.preventDefault();
        this.sendMessage();
      }
      else if (e.key === 'Escape' && this.isRunning) { e.preventDefault(); this.stopCurrent(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'l') { e.preventDefault(); this.clearMessages(); }
    });

    this.inputEl.addEventListener('paste', async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file') {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) await this.handleFile(file);
        }
      }
    });

    inputBox.addEventListener('dragover',  (e) => { e.preventDefault(); inputBox.addClass('cb-drag-over'); });
    inputBox.addEventListener('dragleave', ()  => { inputBox.removeClass('cb-drag-over'); });
    inputBox.addEventListener('drop', async (e) => {
      e.preventDefault();
      inputBox.removeClass('cb-drag-over');
      const files = e.dataTransfer?.files;
      if (!files) return;
      for (const f of files) await this.handleFile(f);
    });
  }

  makeIconButton(container, iconName, ariaLabel, onClick) {
    const btn = container.createEl('button', { cls: 'cb-icon-btn', attr: { 'aria-label': ariaLabel } });
    obsidian.setIcon(btn, iconName);
    btn.onclick = onClick;
    return btn;
  }

  makeToolbarButton(container, iconName, ariaLabel, onClick) {
    const btn = container.createEl('button', { cls: 'cb-toolbar-btn', attr: { 'aria-label': ariaLabel } });
    obsidian.setIcon(btn, iconName);
    btn.onclick = onClick;
    return btn;
  }

  // ─── Welcome ─────────────────────────────────────────────

  renderWelcome() {
    const welcome = this.messagesContainer.createDiv({ cls: 'cb-welcome' });
    welcome.createDiv({ text: this.t('welcomeTitle', { version: PLUGIN_VERSION }), cls: 'cb-welcome-title' });
    welcome.createDiv({ text: this.t('welcomeLine'), cls: 'cb-welcome-line' });

    welcome.createDiv({ text: this.t('welcomeFeaturesTitle'), cls: 'cb-welcome-section' });
    const newFeatures = [
      this.t('featureToolVisible'),
      this.t('featureDiff'),
      this.t('featureMultiTurn'),
      this.t('featureModes'),
      this.t('featureCost'),
    ];
    const ul1 = welcome.createDiv({ cls: 'cb-welcome-list' });
    newFeatures.forEach(t => ul1.createDiv({ text: '• ' + t, cls: 'cb-welcome-item' }));

    welcome.createDiv({ text: this.t('welcomeAskTitle'), cls: 'cb-welcome-section' });
    const examples = [
      this.t('examplePluginStatus'),
      this.t('exampleDesignTokens'),
      this.t('exampleBrief'),
      this.t('exampleTokenReview'),
    ];
    const ul2 = welcome.createDiv({ cls: 'cb-welcome-examples' });
    examples.forEach(text => {
      const li = ul2.createDiv({ cls: 'cb-welcome-example' });
      li.setText(text);
      li.onclick = () => { this.inputEl.value = text; this.inputEl.focus(); };
    });

    welcome.createDiv({
      cls: 'cb-welcome-hint',
      text: this.t('welcomeHint')
    });
  }

  // ─── 模式 ────────────────────────────────────────────────

  setMode(mode) {
    if (!PERMISSION_MODES[mode]) return;
    this.currentMode = mode;
    if (this.modeSelectorEl && this.modeSelectorEl.tagName === 'SELECT') this.modeSelectorEl.value = mode;
    this.modeSelectorEl?.querySelectorAll?.('.cb-mode-btn').forEach(btn => {
      btn.toggleClass('cb-mode-active', btn.getAttribute('data-mode') === mode);
    });
    const info = PERMISSION_MODES[mode];
    this.updateStatus(this.t('statusMode', { mode: info.label, desc: this.plugin.getModeDesc(mode) }));
  }

  // ─── 新 session ─────────────────────────────────────────

  newSession() {
    this.stopCurrent();
    this.sessionId = null;
    this.sessionFile = null;
    this.messages = [];
    this.contextItems = [];
    this.startedAt = Date.now();
    this.headerSessionEl.setText('•');
    this.headerSessionEl.title = this.t('sessionNew');
    this.savedIndicatorEl?.empty();
    this.renderContextItems();
    this.toolCards.clear();
    this.messagesContainer.empty();
    this.renderWelcome();
    this.updateStatus(this.t('statusNewSession'));
  }

  // ─── 附件 ────────────────────────────────────────────────

  async handleFile(file) {
    try {
      const vaultRoot = this.getVaultBasePath();
      const attachDir = path.join(vaultRoot, this.plugin.settings.attachmentsDir);
      if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true });

      const ts = Date.now();
      const safeName = (file.name || 'paste').replace(/[^a-zA-Z0-9._-]/g, '_');
      const fileName = `${ts}-${safeName}` + (file.name?.includes('.') ? '' : '.png');
      const filePath = path.join(attachDir, fileName);

      const buf = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(filePath, buf);

      this.attachments.push({
        name: file.name || fileName,
        path: filePath,
        relPath: path.join(this.plugin.settings.attachmentsDir, fileName),
        size: file.size,
        type: file.type
      });
      this.renderAttachments();
    } catch (e) {
      new obsidian.Notice(`附件保存失败: ${e.message}`);
    }
  }

  renderAttachments() {
    if (!this.attachmentsBar) return;
    this.attachmentsBar.empty();
    if (this.attachments.length === 0) {
      this.attachmentsBar.addClass('cb-hidden');
      return;
    }
    this.attachmentsBar.removeClass('cb-hidden');

    this.attachments.forEach((att, idx) => {
      const chip = this.attachmentsBar.createDiv({ cls: 'cb-chip' });
      const icon = chip.createSpan({ cls: 'cb-chip-icon' });
      obsidian.setIcon(icon, this.isImage(att) ? 'image' : 'file');

      chip.createSpan({ cls: 'cb-chip-name', text: this.truncate(att.name, 26), title: att.name });
      chip.createSpan({ cls: 'cb-chip-size', text: this.formatSize(att.size) });

      const remove = chip.createEl('button', { cls: 'cb-chip-remove', attr: { 'aria-label': this.t('remove') } });
      obsidian.setIcon(remove, 'x');
      remove.onclick = (e) => {
        e.stopPropagation();
        this.attachments.splice(idx, 1);
        this.renderAttachments();
      };
    });
  }

  addContextItem(item) {
    if (!item?.path && !item?.selectedText) return;
    const id = this.getContextItemId(item);
    const existingIndex = this.contextItems.findIndex(ctx => this.getContextItemId(ctx) === id);
    if (existingIndex >= 0) this.contextItems.splice(existingIndex, 1);
    this.contextItems.unshift({ ...item, id });
    this.contextItems = this.contextItems.slice(0, ACTIVE_CONTEXT_MAX_ITEMS);
    this.renderContextItems();
    this.updateStatus(this.t('statusContextAdded', { name: item.name || item.path }));
  }

  getContextItemId(item) {
    if (item.type === 'selection') return `selection:${item.path}:${item.startLine}:${item.endLine}:${this.simpleHash(item.selectedText || '')}`;
    if (item.type === 'ai_quote') return `ai_quote:${this.simpleHash(item.selectedText || '')}`;
    return `${item.type || 'file'}:${item.path}`;
  }

  simpleHash(text) {
    let h = 0;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }

  renderContextItems() {
    if (!this.contextBar) return;
    this.contextBar.empty();
    if (!this.contextItems.length) {
      this.contextBar.addClass('cb-hidden');
      return;
    }
    this.contextBar.removeClass('cb-hidden');

    const label = this.contextBar.createSpan({ cls: 'cb-context-label', text: this.t('contextLabel') });
    label.title = this.t('contextHint');

    this.contextItems.forEach((ctx, idx) => {
      const chip = this.contextBar.createDiv({ cls: 'cb-context-chip' });
      const icon = chip.createSpan({ cls: 'cb-context-icon' });
      obsidian.setIcon(icon, ctx.type === 'folder' ? 'folder' : ctx.type === 'selection' ? 'text-cursor-input' : ctx.type === 'ai_quote' ? 'quote' : 'file-text');
      const text = ctx.type === 'selection'
        ? `${ctx.name}:${ctx.startLine}`
        : ctx.type === 'ai_quote'
          ? ctx.name || this.t('contextAIQuote')
        : ctx.path;
      chip.createSpan({ cls: 'cb-context-name', text: this.truncate(text, 34), title: ctx.path });

      const remove = chip.createEl('button', { cls: 'cb-context-remove', attr: { 'aria-label': this.t('contextRemove') } });
      obsidian.setIcon(remove, 'x');
      remove.onclick = (e) => {
        e.stopPropagation();
        this.contextItems.splice(idx, 1);
        this.renderContextItems();
      };
    });

    const clearBtn = this.contextBar.createEl('button', { cls: 'cb-context-clear', text: this.t('contextClear') });
    clearBtn.onclick = () => {
      this.contextItems = [];
      this.renderContextItems();
    };
  }

  openFilePicker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = e.target.files;
      if (!files) return;
      for (const f of files) await this.handleFile(f);
    };
    input.click();
  }

  isImage(att) { return att.type?.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(att.name); }
  formatSize(b) { if (!b) return ''; if (b < 1024) return `${b}B`; if (b < 1024 * 1024) return `${(b/1024).toFixed(0)}KB`; return `${(b/1024/1024).toFixed(1)}MB`; }
  truncate(s, n) { return !s || s.length <= n ? s : s.slice(0, n - 1) + '…'; }

  // ─── 斜杠命令 ──────────────────────────────────────────

  async handleSlash(text) {
    const t = text.trim();
    const lower = t.toLowerCase();

    if (lower === '/help' || lower === '/?')   { this.addSystemMessage(SLASH_HELP); return true; }
    if (lower === '/clear')                     { this.clearMessages(); return true; }
    if (lower === '/cwd')                       { this.addSystemMessage(`**cwd**: \`${this.getVaultBasePath()}\``); return true; }
    if (lower === '/session')                   { this.addSystemMessage(`**Current session_id**: ${this.sessionId ? '`' + this.sessionId + '`' : '(none, will create on next message)'}`); return true; }
    if (lower === '/doctor')                    { await this.backendDoctorCommand(); return true; }
    if (lower === '/login')                     { await this.backendLoginCommand(); return true; }
    if (lower === '/setup')                     { this.plugin.openModelGatewaySetup(); return true; }
    if (lower === '/scan')                      { await this.quickScanCommand(); return true; }
    if (lower === '/version') {
      const backend = BACKENDS[this.currentBackend];
      const cfg = this.getCurrentBackendConfig();
      const cliPath = cfg.path || backend?.defaultPath || this.currentBackend;
      const out = await this.spawnAndCapture(cliPath, ['--version']);
      this.addSystemMessage(`**${backend?.label || 'AI'} 版本**: ${out.trim()}`);
      return true;
    }
    if (lower.startsWith('/model ')) {
      const m = t.slice(7).trim();
      const cfg = this.getCurrentBackendConfig();
      cfg.model = m;
      if (!this.plugin.settings.backends) this.plugin.settings.backends = {};
      this.plugin.settings.backends[this.currentBackend] = cfg;
      await this.plugin.saveSettings();
      this.refreshModelDisplay();
      this.addSystemMessage(`✓ 模型切换: **${m || 'default'}**`);
      return true;
    }
    if (lower.startsWith('/mode ')) {
      const m = t.slice(6).trim().toLowerCase();
      const map = { default: 'default', plan: 'plan', acceptedits: 'acceptEdits', accept: 'acceptEdits', bypass: 'bypass' };
      const resolved = map[m] || m;
      if (PERMISSION_MODES[resolved]) {
        this.setMode(resolved);
        this.addSystemMessage(`✓ 模式: **${PERMISSION_MODES[resolved].label}**`);
      } else {
        this.addSystemMessage('❌ 未知模式. 可选: default / plan / acceptEdits / bypass');
      }
      return true;
    }
    if (lower === '/resume') {
      if (this.sessionId) this.addSystemMessage(`✓ 当前已挂在 session \`${this.sessionId}\``);
      else this.addSystemMessage('⚠ 当前没有 session, 发条消息会自动创建');
      return true;
    }

    // ─── Figma Bridge 命令族 ───────────────────────────
    if (lower === '/figma' || lower === '/figma help') {
      this.addSystemMessage(FIGMA_HELP);
      return true;
    }
    if (lower === '/figma status') {
      await this.figmaStatusCommand();
      return true;
    }
    if (lower === '/figma connect' || lower === '/figma start') {
      await this.figmaConnectCommand();
      return true;
    }
    if (lower === '/figma stop' || lower === '/figma kill') {
      await this.figmaStopCommand();
      return true;
    }

    return false;
  }

  // ─── Figma Bridge 实现 ──────────────────────────────────

  async checkFigmaBridgeStatus() {
    const vaultRoot = this.getVaultBasePath();
    // 用 lsof 检 port, pgrep 检 Figma
    const portOut = await this.spawnAndCapture('lsof', ['-ti', `:${FIGMA_BRIDGE_PORT}`]);
    const wsRunning = portOut.trim().length > 0 && !portOut.startsWith('error');

    const pidOut = await this.spawnAndCapture('pgrep', ['-x', 'Figma']);
    const figmaRunning = pidOut.trim().length > 0 && !pidOut.startsWith('error');

    let state = 'off';            // 全没起
    if (wsRunning && figmaRunning) state = 'on';     // 双开
    else if (wsRunning || figmaRunning) state = 'partial'; // 半通

    return {
      state,
      wsRunning,
      wsPid: wsRunning ? portOut.trim().split('\n')[0] : null,
      figmaRunning,
      figmaPid: figmaRunning ? pidOut.trim().split('\n')[0] : null,
    };
  }

  async figmaStatusCommand() {
    const s = await this.checkFigmaBridgeStatus();
    const stateIcon = s.state === 'on' ? '🟢' : s.state === 'partial' ? '🟡' : '⚫';
    const stateText = s.state === 'on' ? '通' : s.state === 'partial' ? '半通' : '没起';

    let md = `**${stateIcon} Figma Bridge: ${stateText}**\n\n`;
    md += `| 组件 | 状态 |\n|------|------|\n`;
    md += `| WebSocket (port ${FIGMA_BRIDGE_PORT}) | ${s.wsRunning ? `✓ 运行 PID ${s.wsPid}` : '✗ 未运行'} |\n`;
    md += `| Figma Desktop | ${s.figmaRunning ? `✓ 运行 PID ${s.figmaPid}` : '✗ 未运行'} |\n\n`;

    if (s.state === 'off') {
      md += `**下一步**: \`/figma connect\` 一键启动\n`;
    } else if (s.state === 'partial') {
      md += `**下一步**: \`/figma connect\` 补齐缺的服务\n`;
    } else {
      md += `**下一步**: 在 Figma Desktop 打开 Claude DesignER 插件, 输入 channel + 点 Connect\n`;
      md += `然后跟 AI 说: \"用 figma-edit get_document_info 看 Figma 当前文件结构\"\n`;
    }

    this.addSystemMessage(md);
    this.updateFigmaIndicator(s.state);
  }

  async figmaConnectCommand() {
    const vaultRoot = this.getVaultBasePath();
    const scriptPath = `${vaultRoot}/_scripts/start-figma-bridge.sh`;

    this.addSystemMessage('🌉 启动 Figma Bridge... (新 Terminal 窗口会弹出)');

    const out = await this.spawnAndCapture('bash', [scriptPath]);
    const formatted = '```\n' + out.slice(0, 3000) + '\n```';
    this.addSystemMessage(formatted);

    // 跑完刷新一下指示灯
    setTimeout(() => this.refreshFigmaIndicator(), 2000);
  }

  async figmaStopCommand() {
    const vaultRoot = this.getVaultBasePath();
    const scriptPath = `${vaultRoot}/_scripts/stop-figma-bridge.sh`;
    const out = await this.spawnAndCapture('bash', [scriptPath]);
    this.addSystemMessage('```\n' + out.slice(0, 2000) + '\n```');
    setTimeout(() => this.refreshFigmaIndicator(), 1000);
  }

  async refreshFigmaIndicator() {
    const s = await this.checkFigmaBridgeStatus();
    this.updateFigmaIndicator(s.state);
  }

  updateFigmaIndicator(state) {
    if (!this.figmaIndicatorEl) return;
    const icon = state === 'on' ? '🟢' : state === 'partial' ? '🟡' : '⚫';
    const text = state === 'on' ? 'Figma' : state === 'partial' ? 'Figma' : 'Figma';
    this.figmaIndicatorEl.setText(`${icon} ${text}`);
    this.figmaIndicatorEl.title = this.t('figmaHint');
  }

  openSlashHelp() { this.addSystemMessage(SLASH_HELP); }
  notImplementedYet(name) { new obsidian.Notice(`${name} — 路线图待实装`); }

  async backendDoctorCommand() {
    const backend = BACKENDS[this.currentBackend];
    const cfg = this.getCurrentBackendConfig();
    const cliPath = cfg.path || backend?.defaultPath || this.currentBackend;
    const lines = [];

    lines.push(`**Open Bridge Doctor · ${backend?.label || this.currentBackend}**`);
    lines.push('');
    lines.push(`- backend: \`${this.currentBackend}\``);
    lines.push(`- cli: \`${cliPath}\``);
    lines.push(`- cwd: \`${this.getVaultBasePath()}\``);

    const version = await this.spawnAndCapture(cliPath, ['--version'], { timeoutMs: 8000 });
    lines.push(`- version: ${this.formatDoctorResult(version)}`);

    if (this.currentBackend === 'codex') {
      const vaultRoot = this.getVaultBasePath();
      const gitRoot = this.findGitRoot(vaultRoot);
      const repoMode = this.plugin.settings.codexRepoMode || 'auto';
      lines.push(`- repo mode: \`${repoMode}\``);
      lines.push(`- git root: ${gitRoot ? '`' + gitRoot + '`' : '(none)'}`);
      lines.push(`- skip git check: \`${this.shouldSkipGitRepoCheck('codex', vaultRoot)}\``);
      const login = await this.spawnAndCapture(cliPath, ['login', 'status'], { timeoutMs: 10000 });
      lines.push(`- login: ${this.formatDoctorResult(login)}`);
      lines.push('');
      lines.push('如果 login 不正常：');
      lines.push('1. 在系统终端运行 `codex login`');
      lines.push('2. 登录完成后回到 Obsidian，重新执行 `/doctor`');
      lines.push('3. 如果仍卡住，先在终端跑 `codex exec --skip-git-repo-check --sandbox workspace-write -` 做最小验证');
    } else if (this.currentBackend === 'claude') {
      lines.push('');
      lines.push('如果 Claude 未登录：在系统终端运行 `claude`，按 CLI 提示完成登录。');
    } else {
      lines.push('');
      lines.push('Custom backend 只检查 CLI 是否能执行 `--version`，实际登录状态取决于该 CLI。');
    }

    this.addSystemMessage(lines.join('\n'));
  }

  async backendLoginCommand() {
    if (this.currentBackend === 'codex') {
      const cfg = this.getCurrentBackendConfig();
      const cliPath = cfg.path || 'codex';
      const status = await this.spawnAndCapture(cliPath, ['login', 'status'], { timeoutMs: 10000 });
      this.addSystemMessage([
        '**Codex 登录**',
        '',
        `当前状态：${this.formatDoctorResult(status)}`,
        '',
        '如果未登录，请在系统终端运行：',
        '```bash',
        'codex login',
        '```',
        '登录完成后回到 Obsidian，执行 `/doctor` 验证。',
        '',
        '不建议在插件面板里直接跑交互式登录，因为浏览器授权和 TUI 输入容易让子进程卡住。'
      ].join('\n'));
      return;
    }

    if (this.currentBackend === 'claude') {
      this.addSystemMessage([
        '**Claude 登录**',
        '',
        '请在系统终端运行：',
        '```bash',
        'claude',
        '```',
        '按 CLI 提示完成登录后，回到 Obsidian 执行 `/doctor` 验证。'
      ].join('\n'));
      return;
    }

    this.addSystemMessage('Custom backend 的登录方式取决于你配置的 CLI。请先用 `/doctor` 检查 CLI 是否可执行。');
  }

  formatDoctorResult(text) {
    const clean = String(text || '').trim();
    if (!clean) return '无输出';
    const firstLines = clean.split('\n').slice(0, 6).join('\n');
    return `\n\`\`\`\n${firstLines}\n\`\`\``;
  }

  async quickScanCommand() {
    const summary = this.buildVaultScanSummary();
    this.addSystemMessage(summary);
  }

  shouldUseQuickScan(raw) {
    if (this.attachments.length > 0) return false;
    return /(看|扫|分析|了解).*(目录|文件夹|项目结构|本地目录|整体项目|仓库结构)|目录结构|项目目录/i.test(raw);
  }

  buildVaultScanSummary() {
    const root = this.getVaultBasePath();
    const scan = this.scanDirectory(root, QUICK_SCAN_MAX_DEPTH, QUICK_SCAN_MAX_ITEMS);
    const gitRoot = this.findGitRoot(root);
    const topDirs = scan.topLevel.filter(x => x.type === 'dir').map(x => x.name);
    const topFiles = scan.topLevel.filter(x => x.type === 'file').map(x => x.name);
    const hints = this.inferProjectHints(root, topDirs, topFiles, scan);

    return [
      '**本地目录快速扫描**',
      '',
      `- root: \`${root}\``,
      `- git: ${gitRoot ? '`' + gitRoot + '`' : '不是 Git 仓库'}`,
      `- top dirs: ${topDirs.length ? topDirs.map(x => '`' + x + '`').join(' ') : '(none)'}`,
      `- top files: ${topFiles.length ? topFiles.slice(0, 18).map(x => '`' + x + '`').join(' ') : '(none)'}`,
      `- 初步判断: ${hints}`,
      '',
      '```text',
      scan.tree,
      '```',
      scan.truncated ? `\n已截断：最多 ${QUICK_SCAN_MAX_ITEMS} 项，深度 ${QUICK_SCAN_MAX_DEPTH}。` : '',
      '\n下一步可以继续问：`基于这个扫描结果，判断这个项目是什么类型`。'
    ].filter(Boolean).join('\n');
  }

  scanDirectory(root, maxDepth, maxItems) {
    let count = 0;
    let truncated = false;
    const topLevel = [];
    const lines = [path.basename(root) + '/'];

    const walk = (dir, depth, prefix) => {
      if (count >= maxItems) { truncated = true; return; }
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
          .filter(e => !QUICK_SCAN_IGNORES.has(e.name))
          .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
      } catch (e) {
        lines.push(prefix + '└── ' + '[无法读取]');
        return;
      }

      if (depth === 0) {
        for (const e of entries) topLevel.push({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' });
      }

      entries.forEach((entry, index) => {
        if (count >= maxItems) { truncated = true; return; }
        count++;
        const isLast = index === entries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const name = entry.name + (entry.isDirectory() ? '/' : '');
        lines.push(prefix + connector + name);
        if (entry.isDirectory() && depth + 1 < maxDepth) {
          walk(path.join(dir, entry.name), depth + 1, prefix + (isLast ? '    ' : '│   '));
        }
      });
    };

    walk(root, 0, '');
    return { tree: lines.join('\n'), topLevel, truncated, count };
  }

  inferProjectHints(root, topDirs, topFiles, scan) {
    const names = new Set([...topDirs, ...topFiles]);
    const hints = [];
    if (names.has('package.json')) hints.push('前端 / Node 项目');
    if (names.has('pyproject.toml') || names.has('requirements.txt')) hints.push('Python 项目');
    if (names.has('Cargo.toml')) hints.push('Rust 项目');
    if (names.has('README.md')) hints.push('有 README，可先读项目说明');
    if (names.has('INDEX.md') || names.has('.obsidian')) hints.push('Obsidian Vault / 知识库');
    if (names.has('_shared') || names.has('designers')) hints.push('UED 设计资产仓库结构');
    if (names.has('plugins')) hints.push('包含插件源目录');
    return hints.length ? hints.join('；') : '普通本地目录，需要继续读 README / 关键文件确认';
  }

  // ─── 发消息 ──────────────────────────────────────────────

  async sendMessage() {
    const backendLabel = BACKENDS[this.currentBackend]?.label || 'AI';
    if (this.isRunning) { new obsidian.Notice(`${backendLabel} 思考中, Esc 中断`); return; }
    const raw = this.inputEl.value.trim();
    if (!raw && this.attachments.length === 0 && this.contextItems.length === 0) return;
    const userText = raw || '请基于我加入的上下文进行分析。';

    if (/^codex\s+login\b/i.test(raw)) {
      const handled = await this.handleSlash('/login');
      if (handled) { this.inputEl.value = ''; return; }
    }
    if (/^codex\s+(status|doctor)\b/i.test(raw)) {
      const handled = await this.handleSlash('/doctor');
      if (handled) { this.inputEl.value = ''; return; }
    }

    if (raw.startsWith('/')) {
      const handled = await this.handleSlash(raw);
      if (handled) { this.inputEl.value = ''; return; }
    }

    if (this.shouldUseQuickScan(raw)) {
      this.removeWelcome();
      this.addUserMessage(raw);
      this.inputEl.value = '';
      this.addSystemMessage(this.buildVaultScanSummary());
      await this.saveSessionToVault();
      return;
    }

    this.removeWelcome();

    const display = this.composeUserDisplay(userText);
    this.addUserMessage(display);

    const fullPrompt = this.composePromptForAI(userText);

    this.inputEl.value = '';
    const sentAttachments = [...this.attachments];
    this.attachments = [];
    this.renderAttachments();

    this.isRunning = true;
    this.updateStatus(`🤔 ${backendLabel} 思考中...`);
    try {
      await this.runAI(fullPrompt);
    } finally {
      this.isRunning = false;
      this.updateStatus(this.currentMode === 'bypass' ? '⚠ Bypass · 就绪' : '就绪');
      // v0.6: 把当轮 assistant turn 完成态推入 messages, 然后写入 vault
      this.finalizeTurn();
      await this.saveSessionToVault();
    }
  }

  composeUserDisplay(text) {
    const blocks = [];
    if (this.contextItems.length > 0) {
      const list = this.contextItems.map(ctx => `\`${ctx.type === 'selection' ? `${ctx.path}:${ctx.startLine}` : ctx.path}\``).join(' · ');
      blocks.push(`📌 上下文: ${list}`);
    }
    if (this.attachments.length > 0) {
      const list = this.attachments.map(a => `\`${a.name}\``).join(' · ');
      blocks.push(`📎 附件: ${list}`);
    }
    blocks.push(text);
    return blocks.filter(Boolean).join('\n\n');
  }

  composePromptForAI(text) {
    const parts = [];
    const context = this.buildPromptContext();
    if (context) parts.push(context);
    const activeContext = this.buildActiveContextPrompt();
    if (activeContext) parts.push(activeContext);
    if (this.attachments.length > 0) {
      const lines = this.attachments.map(a => `- ${a.relPath}` + (this.isImage(a) ? ' (图片)' : '')).join('\n');
      parts.push(`用户附了以下文件 (vault 内相对路径, 用 Read 工具打开):\n${lines}`);
    }
    const isContinue = /^(继续|接着|继续上次|继续刚才|继续上一轮)$/i.test(text.trim());
    parts.push(isContinue
      ? `用户消息: ${text}\n\n请基于上面的最近上下文继续推进上一项未完成任务，不要要求用户重新描述。`
      : `用户消息:\n${text}`);
    return parts.join('\n\n---\n\n');
  }

  buildActiveContextPrompt() {
    if (!this.contextItems.length) return '';
    const blocks = [];
    let budget = ACTIVE_CONTEXT_MAX_CHARS;

    for (const ctx of this.contextItems) {
      if (budget <= 0) break;
      let block = '';
      if (ctx.type === 'selection') {
        block = [
          `### 选中文本: ${ctx.path}:${ctx.startLine}-${ctx.endLine}`,
          '用户明确把这段内容加入上下文，优先围绕它讨论。',
          '',
          '选中文本:',
          '```md',
          this.truncate(ctx.selectedText || '', 3000),
          '```',
          ctx.surroundingText ? '\n附近上下文:\n```md\n' + this.truncate(ctx.surroundingText, 3000) + '\n```' : ''
        ].join('\n');
      } else if (ctx.type === 'ai_quote') {
        block = [
          `### AI 输出引用: ${ctx.name || 'AI 片段'}`,
          '这是用户从 Open Bridge 的 AI 回复中手动引用的内容。后续讨论优先围绕这段内容。',
          '',
          '引用内容:',
          '```md',
          this.truncate(ctx.selectedText || '', 4000),
          '```'
        ].join('\n');
      } else if (ctx.type === 'folder') {
        block = [
          `### 目录上下文: ${ctx.path}`,
          '这是用户从 Obsidian 文件列表加入的目录。需要时先扫描/读取该目录，不要假设目录内容。'
        ].join('\n');
      } else {
        const preview = this.readContextFilePreview(ctx.path, Math.min(4000, budget));
        block = [
          `### 文件上下文: ${ctx.path}`,
          '这是用户从 Obsidian 文件列表或当前文档加入的文件。需要更完整信息时继续读取该文件。',
          preview ? '\n文件预览:\n```md\n' + preview + '\n```' : ''
        ].join('\n');
      }

      block = this.truncate(block, budget);
      blocks.push(block);
      budget -= block.length;
    }

    return `以下是用户手动挂载到 Open Bridge 的当前讨论上下文，请优先用于判断“这个/这里/这句/这个文件”等指代：\n\n${blocks.join('\n\n')}`;
  }

  readContextFilePreview(relPath, limit) {
    try {
      const full = path.join(this.getVaultBasePath(), relPath);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return '';
      const stat = fs.statSync(full);
      if (stat.size > 1024 * 1024) return `文件较大 (${this.formatSize(stat.size)})，请按需读取: ${relPath}`;
      const text = fs.readFileSync(full, 'utf8');
      return this.truncate(text, limit || 4000);
    } catch (e) {
      return '';
    }
  }

  buildPromptContext() {
    const history = this.messages
      .slice(0, -1)
      .filter(m => ['user', 'assistant', 'system'].includes(m.role))
      .slice(-PROMPT_CONTEXT_MAX_MESSAGES);
    if (history.length === 0) return '';

    let body = '';
    for (const msg of history) {
      const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
      const content = this.truncate((msg.content || '').trim(), 1200);
      if (!content) continue;
      body += `### ${role}\n${content}\n\n`;
    }
    body = body.trim();
    if (!body) return '';
    if (body.length > PROMPT_CONTEXT_MAX_CHARS) {
      body = body.slice(body.length - PROMPT_CONTEXT_MAX_CHARS);
    }
    return `以下是本地会话的最近上下文，请用于理解“继续”等指令：\n\n${body}`;
  }

  removeWelcome() {
    const w = this.messagesContainer.querySelector('.cb-welcome');
    if (w) w.remove();
  }

  // ─── 渲染消息: 用户 / 系统 / 助手 ───────────────────────

  addUserMessage(text) {
    const msgEl = this.messagesContainer.createDiv({ cls: 'cb-message cb-message-user' });
    const content = msgEl.createDiv({ cls: 'cb-content' });
    content.style.whiteSpace = 'pre-wrap';
    content.setText(text);
    this.addMessageCopyButton(msgEl, () => text);
    this.scrollToBottom();
    // 推到 messages 数组用于历史保存
    this.messages.push({ role: 'user', content: text, timestamp: Date.now() });
  }

  addSystemMessage(markdown) {
    const msgEl = this.messagesContainer.createDiv({ cls: 'cb-message cb-message-system' });
    msgEl.createDiv({ cls: 'cb-role', text: '⚙ System' });
    const content = msgEl.createDiv({ cls: 'cb-content' });
    this.renderMarkdown(markdown, content);
    this.addMessageCopyButton(msgEl, () => markdown);
    this.scrollToBottom();
    this.messages.push({ role: 'system', content: markdown, timestamp: Date.now() });
  }

  // 创建一个助手 bubble, 返回 content 元素 (用于流式追加)
  // v0.6: 同步初始化 currentTurn 累积器
  // v0.8.1: 加复制按钮
  createAssistantBubble() {
    const msgEl = this.messagesContainer.createDiv({ cls: 'cb-message cb-message-assistant' });
    msgEl.createDiv({ cls: 'cb-role', text: '🤖 ' + (BACKENDS[this.currentBackend]?.label || 'AI') });
    this.currentTurn = { role: 'assistant', text: '', toolCalls: [], timestamp: Date.now() };
    const content = msgEl.createDiv({ cls: 'cb-content' });
    const getContent = () => {
      // 优先 currentTurn.text (streaming 中) → fallback DOM text
      return this.currentTurn?.text || content.innerText || '';
    };
    this.addMessageQuoteButton(msgEl, getContent, content);
    this.addMessageCopyButton(msgEl, getContent);
    return content;
  }

  addMessageQuoteButton(msgEl, getContent, contentEl) {
    const btn = msgEl.createEl('button', {
      cls: 'cb-msg-quote-btn',
      attr: { 'aria-label': '引用此 AI 回复为上下文' }
    });
    obsidian.setIcon(btn, 'quote');
    btn.onclick = (e) => {
      e.stopPropagation();
      const selected = this.getSelectionInside(contentEl);
      const text = (selected || getContent() || '').trim();
      if (!text) {
        new obsidian.Notice('可引用内容为空');
        return;
      }
      this.addAIQuoteContext(text, selected ? 'AI 选中片段' : 'AI 回复全文');
      btn.empty();
      obsidian.setIcon(btn, 'check');
      btn.addClass('cb-msg-quote-done');
      setTimeout(() => {
        btn.empty();
        obsidian.setIcon(btn, 'quote');
        btn.removeClass('cb-msg-quote-done');
      }, 1200);
    };
    return btn;
  }

  getSelectionInside(container) {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return '';
    const range = selection.getRangeAt(0);
    const common = range.commonAncestorContainer;
    const node = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
    if (!node || !container.contains(node)) return '';
    return selection.toString();
  }

  addAIQuoteContext(text, name = 'AI 片段') {
    this.addContextItem({
      type: 'ai_quote',
      name,
      selectedText: text,
      backend: this.currentBackend,
      addedAt: Date.now()
    });
    new obsidian.Notice(`已引用到上下文: ${name}`);
  }

  // 给消息气泡加 hover 显示的复制按钮 (v0.8.1)
  addMessageCopyButton(msgEl, getContent) {
    const btn = msgEl.createEl('button', {
      cls: 'cb-msg-copy-btn',
      attr: { 'aria-label': '复制此消息内容' }
    });
    obsidian.setIcon(btn, 'copy');
    btn.onclick = async (e) => {
      e.stopPropagation();
      try {
        const text = getContent();
        if (!text) {
          new obsidian.Notice('消息为空');
          return;
        }
        await navigator.clipboard.writeText(text);
        // 视觉反馈: 换成对勾
        btn.empty();
        obsidian.setIcon(btn, 'check');
        btn.addClass('cb-msg-copy-done');
        setTimeout(() => {
          btn.empty();
          obsidian.setIcon(btn, 'copy');
          btn.removeClass('cb-msg-copy-done');
        }, 1500);
      } catch (err) {
        new obsidian.Notice('复制失败: ' + err.message);
      }
    };
    return btn;
  }

  renderMarkdown(text, container) {
    container.empty();
    try {
      obsidian.MarkdownRenderer.render(this.app, text, container, '', this);
    } catch (e) {
      try { obsidian.MarkdownRenderer.renderMarkdown(text, container, '', this); }
      catch (e2) { container.setText(text); }
    }
    this.attachCopyButtons(container);
    this.attachInlineQuoteButtons(container);
  }

  attachInlineQuoteButtons(container) {
    container.querySelectorAll('p, li, blockquote').forEach(el => {
      if (el.closest('pre, code')) return;
      if (el.querySelector(':scope > .cb-inline-quote-btn')) return;
      const text = (el.innerText || '').trim();
      if (text.length < 6) return;
      el.addClass('cb-quote-target');
      const btn = document.createElement('button');
      btn.className = 'cb-inline-quote-btn';
      btn.title = '引用这一段到上下文';
      obsidian.setIcon(btn, 'quote');
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.addAIQuoteContext(text, 'AI 段落');
      };
      el.appendChild(btn);
    });
  }

  attachCopyButtons(container) {
    container.querySelectorAll('pre').forEach(pre => {
      if (pre.querySelector('.cb-copy-btn')) return;
      const btn = document.createElement('button');
      btn.className = 'cb-copy-btn';
      btn.title = '复制';
      btn.innerHTML = '⧉';
      btn.onclick = (e) => {
        e.stopPropagation();
        const code = pre.querySelector('code')?.innerText || pre.innerText;
        navigator.clipboard.writeText(code);
        btn.innerHTML = '✓';
        setTimeout(() => btn.innerHTML = '⧉', 1200);
      };
      pre.style.position = 'relative';
      pre.appendChild(btn);
    });
  }

  // ─── 工具卡片 ────────────────────────────────────────────

  TOOL_META = {
    'Read':       { icon: 'book-open',    color: 'blue',    summaryKey: 'file_path' },
    'Write':      { icon: 'file-plus',    color: 'green',   summaryKey: 'file_path' },
    'Edit':       { icon: 'pencil',       color: 'orange',  summaryKey: 'file_path' },
    'MultiEdit':  { icon: 'pencil',       color: 'orange',  summaryKey: 'file_path' },
    'Bash':       { icon: 'terminal',     color: 'red',     summaryKey: 'command' },
    'Grep':       { icon: 'search',       color: 'purple',  summaryKey: 'pattern' },
    'Glob':       { icon: 'folder',       color: 'purple',  summaryKey: 'pattern' },
    'TodoWrite':  { icon: 'list-checks',  color: 'cyan',    summaryKey: null },
    'Task':       { icon: 'bot',          color: 'magenta', summaryKey: 'description' },
    'WebFetch':   { icon: 'globe',        color: 'blue',    summaryKey: 'url' },
    'WebSearch':  { icon: 'search',       color: 'blue',    summaryKey: 'query' },
    'NotebookEdit': { icon: 'pencil',     color: 'orange',  summaryKey: 'notebook_path' },
    '_default':   { icon: 'wrench',       color: 'gray',    summaryKey: null },
  };

  renderToolUse(parentContent, tool) {
    const meta = this.TOOL_META[tool.name] || this.TOOL_META._default;
    const card = parentContent.createDiv({ cls: `cb-tool-card cb-tool-color-${meta.color}` });

    // Header
    const header = card.createDiv({ cls: 'cb-tool-header' });
    const iconEl = header.createSpan({ cls: 'cb-tool-icon' });
    obsidian.setIcon(iconEl, meta.icon);
    header.createSpan({ cls: 'cb-tool-name', text: tool.name });

    let summary = '';
    if (meta.summaryKey && tool.input?.[meta.summaryKey]) {
      summary = String(tool.input[meta.summaryKey]);
    } else {
      summary = this.shortInputSummary(tool.input);
    }
    header.createSpan({ cls: 'cb-tool-summary', text: this.truncate(summary, 64), title: summary });

    const chevron = header.createSpan({ cls: 'cb-tool-chevron' });
    obsidian.setIcon(chevron, 'chevron-down');

    // Body (collapsed by default)
    const body = card.createDiv({ cls: 'cb-tool-body' });
    if (this.plugin.settings.autoCollapseToolBody) body.addClass('cb-collapsed');

    // Input area — 工具特化渲染
    const inputArea = body.createDiv({ cls: 'cb-tool-input-area' });
    this.renderToolInput(inputArea, tool);

    // Result placeholder
    const resultArea = body.createDiv({ cls: 'cb-tool-result-area cb-hidden' });

    // Click header to toggle
    header.onclick = () => body.toggleClass('cb-collapsed', !body.hasClass('cb-collapsed'));

    // 保存引用
    this.toolCards.set(tool.id, { card, body, inputArea, resultArea });

    return card;
  }

  renderToolInput(container, tool) {
    const { name, input = {} } = tool;

    if (name === 'Read') {
      container.createDiv({ cls: 'cb-tool-line', text: `📖 读取: ${input.file_path}` });
      if (input.offset) container.createDiv({ cls: 'cb-tool-line cb-dim', text: `偏移: ${input.offset}, ${input.limit || 'auto'} 行` });
      return;
    }
    if (name === 'Bash') {
      const pre = container.createEl('pre', { cls: 'cb-tool-code' });
      pre.createEl('code', { text: '$ ' + input.command });
      if (input.description) container.createDiv({ cls: 'cb-tool-line cb-dim', text: `// ${input.description}` });
      return;
    }
    if (name === 'Edit' || name === 'MultiEdit') {
      container.createDiv({ cls: 'cb-tool-line', text: `📝 编辑: ${input.file_path}` });
      const edits = name === 'MultiEdit' ? (input.edits || []) : [{ old_string: input.old_string, new_string: input.new_string }];
      edits.forEach((e, i) => {
        const wrap = container.createDiv({ cls: 'cb-diff-wrap' });
        if (edits.length > 1) wrap.createDiv({ cls: 'cb-diff-label', text: `Edit ${i + 1}` });
        this.renderDiff(wrap, e.old_string || '', e.new_string || '');
      });
      return;
    }
    if (name === 'Write') {
      container.createDiv({ cls: 'cb-tool-line', text: `✏️ 写入: ${input.file_path}` });
      const pre = container.createEl('pre', { cls: 'cb-tool-code cb-diff-add' });
      pre.createEl('code', { text: this.truncate(input.content || '', 1500) });
      return;
    }
    if (name === 'Grep') {
      container.createDiv({ cls: 'cb-tool-line', text: `🔍 模式: ${input.pattern}` });
      if (input.path) container.createDiv({ cls: 'cb-tool-line cb-dim', text: `路径: ${input.path}` });
      if (input.glob) container.createDiv({ cls: 'cb-tool-line cb-dim', text: `Glob: ${input.glob}` });
      if (input.output_mode) container.createDiv({ cls: 'cb-tool-line cb-dim', text: `输出: ${input.output_mode}` });
      return;
    }
    if (name === 'Glob') {
      container.createDiv({ cls: 'cb-tool-line', text: `📁 模式: ${input.pattern}` });
      if (input.path) container.createDiv({ cls: 'cb-tool-line cb-dim', text: `根目录: ${input.path}` });
      return;
    }
    if (name === 'TodoWrite') {
      const list = container.createDiv({ cls: 'cb-todos' });
      (input.todos || []).forEach(t => {
        const item = list.createDiv({ cls: `cb-todo-item cb-todo-${t.status}` });
        const iconName = t.status === 'completed' ? 'check-circle' : t.status === 'in_progress' ? 'play-circle' : 'circle';
        obsidian.setIcon(item.createSpan({ cls: 'cb-todo-icon' }), iconName);
        item.createSpan({ cls: 'cb-todo-text', text: t.status === 'in_progress' ? (t.activeForm || t.content) : t.content });
      });
      return;
    }
    if (name === 'WebFetch' || name === 'WebSearch') {
      container.createDiv({ cls: 'cb-tool-line', text: input.url || input.query });
      if (input.prompt) container.createDiv({ cls: 'cb-tool-line cb-dim', text: `提示: ${input.prompt}` });
      return;
    }
    if (name === 'Task') {
      container.createDiv({ cls: 'cb-tool-line', text: `🤖 子代理: ${input.subagent_type || 'default'}` });
      if (input.description) container.createDiv({ cls: 'cb-tool-line cb-dim', text: input.description });
      if (input.prompt) {
        const pre = container.createEl('pre', { cls: 'cb-tool-code' });
        pre.createEl('code', { text: this.truncate(input.prompt, 800) });
      }
      return;
    }

    // Default
    const pre = container.createEl('pre', { cls: 'cb-tool-code' });
    pre.createEl('code', { text: this.shortJSON(input) });
  }

  renderDiff(container, oldText, newText) {
    const diff = container.createDiv({ cls: 'cb-diff' });
    // 简化版按行 diff (LCS 太重, 用最朴素的双栏)
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');

    oldLines.forEach(l => {
      const line = diff.createDiv({ cls: 'cb-diff-line cb-diff-remove' });
      line.createSpan({ cls: 'cb-diff-sign', text: '-' });
      line.createSpan({ cls: 'cb-diff-text', text: l });
    });
    newLines.forEach(l => {
      const line = diff.createDiv({ cls: 'cb-diff-line cb-diff-add' });
      line.createSpan({ cls: 'cb-diff-sign', text: '+' });
      line.createSpan({ cls: 'cb-diff-text', text: l });
    });
  }

  attachToolResult(result) {
    const entry = this.toolCards.get(result.tool_use_id);
    if (!entry) return;

    const { body, resultArea, card } = entry;
    resultArea.removeClass('cb-hidden');
    resultArea.empty();

    const label = resultArea.createDiv({ cls: 'cb-tool-result-label' });
    obsidian.setIcon(label.createSpan(), 'corner-down-right');
    label.createSpan({ text: result.is_error ? '错误' : '结果' });

    if (result.is_error) card.addClass('cb-tool-error');
    else card.addClass('cb-tool-done');

    let content = result.content;
    if (Array.isArray(content)) {
      content = content.map(c => typeof c === 'string' ? c : (c.text || JSON.stringify(c))).join('\n');
    }
    if (typeof content !== 'string') content = JSON.stringify(content);

    const isLong = content.length > 1500;
    const display = isLong ? content.slice(0, 1500) + '\n\n... (' + (content.length - 1500) + ' 字符未显示, 点开看全部)' : content;

    const pre = resultArea.createEl('pre', { cls: 'cb-tool-output' });
    pre.createEl('code', { text: display });

    if (isLong) {
      const moreBtn = resultArea.createEl('button', { cls: 'cb-expand-btn', text: '展开完整输出' });
      let expanded = false;
      moreBtn.onclick = () => {
        expanded = !expanded;
        pre.querySelector('code').textContent = expanded ? content : display;
        moreBtn.setText(expanded ? '折叠' : '展开完整输出');
      };
    }
  }

  shortInputSummary(input) {
    if (!input || typeof input !== 'object') return String(input || '');
    const keys = Object.keys(input);
    if (keys.length === 0) return '';
    const first = keys[0];
    return `${first}: ${String(input[first]).slice(0, 60)}`;
  }

  shortJSON(obj) {
    try { return JSON.stringify(obj, null, 2).slice(0, 1500); }
    catch (e) { return String(obj); }
  }

  // ─── 主流程: runAI with backend dispatch ─────────────────

  async runClaude(prompt) {
    return this.runAI(prompt);
  }

  // v0.5: dispatch 到当前 backend
  async runAI(prompt) {
    const backend = BACKENDS[this.currentBackend];
    if (!backend) {
      const c = this.createAssistantBubble();
      this.renderError(c, '未知 backend', this.currentBackend, '请选 Claude / Codex / Custom');
      return;
    }

    const vaultRoot = this.getVaultBasePath();
    const cfg = this.getCurrentBackendConfig();
    const cliPath = cfg.path || backend.defaultPath;

    if (!cliPath) {
      const c = this.createAssistantBubble();
      this.renderError(c, `${backend.label} CLI 路径未配置`, '',
        `进设置 → ${APP_NAME} → ${backend.label} 行, 填 CLI 路径`);
      return;
    }

    // 助手 bubble + thinking placeholder
    const assistantContent = this.createAssistantBubble();
    const thinkingPlaceholder = assistantContent.createDiv({
      cls: 'cb-thinking-pulse',
      text: `🤔 ${backend.label} 思考中...`
    });

    // 流式累积
    let currentTextSegment = null;
    let currentText = '';

    // build args via backend
    const args = backend.buildArgs(prompt, {
      mode: this.currentMode,
      sessionId: backend.supportsResume ? this.sessionId : null,
      model: cfg.model,
      extraArgs: cfg.extraArgs,
      skipGitRepoCheck: this.shouldSkipGitRepoCheck(backend.id, vaultRoot),
    });

    const enhancedPath = [
      process.env.PATH || '',
      '/usr/local/bin',
      '/opt/homebrew/bin',
      `${process.env.HOME}/.bun/bin`,
      `${process.env.HOME}/.npm-global/bin`,
    ].filter(Boolean).join(':');

    return new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(cliPath, args, {
          cwd: vaultRoot,
          env: { ...process.env, PATH: enhancedPath },
          stdio: [backend.promptStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
          shell: false
        });
        if (backend.promptStdin && proc.stdin) {
          proc.stdin.end(prompt);
        }
      } catch (e) {
        thinkingPlaceholder.remove();
        this.renderError(assistantContent, `启动 ${backend.label} 失败`, e.message,
          `设置里改 ${backend.label} CLI 路径为绝对路径`);
        return resolve();
      }
      this.currentProcess = proc;

      let buffer = '';
      let stderr = '';
      let placeholderRemoved = false;
      let timedOut = false;
      const timeout = setTimeout(() => {
        if (this.currentProcess !== proc) return;
        timedOut = true;
        try { proc.kill('SIGTERM'); } catch (e) { /* noop */ }
        ensurePlaceholderRemoved();
        this.renderError(
          assistantContent,
          `${backend.label} 响应超时`,
          `超过 ${Math.round(BACKEND_RUN_TIMEOUT_MS / 1000)} 秒没有结束。`,
          this.currentBackend === 'codex'
            ? '先发送 /doctor 检查 Codex 登录状态；如未登录，在系统终端运行 codex login。'
            : '先发送 /doctor 检查当前 backend 状态。'
        );
        if (this.currentTurn) {
          this.currentTurn.text = `❌ ${backend.label} 响应超时\n\n超过 ${Math.round(BACKEND_RUN_TIMEOUT_MS / 1000)} 秒没有结束。`;
        }
      }, BACKEND_RUN_TIMEOUT_MS);

      const ensurePlaceholderRemoved = () => {
        if (!placeholderRemoved) {
          thinkingPlaceholder.remove();
          placeholderRemoved = true;
        }
      };

      const ensureTextSegment = () => {
        if (!currentTextSegment) {
          currentText = '';
          currentTextSegment = assistantContent.createDiv({ cls: 'cb-text-segment' });
        }
        return currentTextSegment;
      };

      const appendText = (text, recordTurn = !['claude-json', 'codex-json'].includes(backend.streamFormat)) => {
        ensurePlaceholderRemoved();
        const seg = ensureTextSegment();
        currentText += text;
        if (recordTurn && this.currentTurn) this.currentTurn.text += text;
        this.renderMarkdown(currentText, seg);
        this.scrollToBottom();
      };

      const finishTextSegment = () => {
        currentTextSegment = null;
        currentText = '';
      };

      let activityLogEl = null;
      let activityHeaderEl = null;
      let activitySummaryEl = null;
      let activityChevronEl = null;
      let activityLines = [];
      let lastActivityAt = Date.now();
      let activityExpanded = false;
      const ensureActivityLog = () => {
        if (!activityLogEl) {
          ensurePlaceholderRemoved();
          const card = assistantContent.createDiv({ cls: 'cb-thinking-card cb-activity-card' });
          activityHeaderEl = card.createDiv({ cls: 'cb-thinking-header cb-activity-header' });
          obsidian.setIcon(activityHeaderEl.createSpan({ cls: 'cb-thinking-icon' }), 'activity');
          activityHeaderEl.createSpan({ text: `${backend.label} 运行过程`, cls: 'cb-thinking-label' });
          activitySummaryEl = activityHeaderEl.createSpan({ cls: 'cb-activity-summary', text: '准备中' });
          activityChevronEl = activityHeaderEl.createSpan({ cls: 'cb-tool-chevron' });
          obsidian.setIcon(activityChevronEl, 'chevron-right');
          activityLogEl = card.createDiv({ cls: 'cb-thinking-body cb-collapsed' });
          activityHeaderEl.onclick = () => {
            activityExpanded = !activityExpanded;
            activityLogEl.toggleClass('cb-collapsed', !activityExpanded);
            activityChevronEl.empty();
            obsidian.setIcon(activityChevronEl, activityExpanded ? 'chevron-down' : 'chevron-right');
          };
        }
        return activityLogEl;
      };
      const appendActivity = (line) => {
        if (!line) return;
        lastActivityAt = Date.now();
        activityLines.push(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${line}`);
        activityLines = activityLines.slice(-18);
        ensureActivityLog().setText(activityLines.join('\n'));
        if (activitySummaryEl) {
          activitySummaryEl.setText(`${this.truncate(line, 72)} · ${activityLines.length} 条`);
          activitySummaryEl.title = line;
        }
        this.scrollToBottom();
      };
      const heartbeat = setInterval(() => {
        if (this.currentProcess !== proc) return;
        const seconds = Math.max(1, Math.round((Date.now() - lastActivityAt) / 1000));
        appendActivity(`仍在运行，最近 ${seconds}s 没有新事件`);
      }, 15000);

      const handleJsonLine = (line) => {
        if (!line.trim()) return;
        try {
          const evt = JSON.parse(line);
          if (backend.streamFormat === 'claude-json') {
            this.handleStreamEvent(evt, {
              assistantContent,
              ensurePlaceholderRemoved,
              appendText,
              finishTextSegment,
            });
          } else if (backend.streamFormat === 'codex-json') {
            this.handleCodexEvent(evt, { appendText, appendActivity, finishTextSegment });
          }
        } catch (e) {
          appendActivity(line.slice(0, 220));
          console.warn('[' + APP_NAME + '] parse error', e, line.slice(0, 200));
        }
      };

      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString();

        if (backend.streamFormat === 'claude-json' || backend.streamFormat === 'codex-json') {
          buffer += text;
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) handleJsonLine(line);
        } else {
          // text / codex / custom: 直接拼接渲染
          appendText(text);
        }
      });

      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        if (backend.streamFormat === 'codex-json') {
          text.split('\n').filter(Boolean).forEach(line => appendActivity('stderr: ' + line.slice(0, 220)));
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        clearInterval(heartbeat);
        // 处理 buffer 剩余 (claude-json)
        if ((backend.streamFormat === 'claude-json' || backend.streamFormat === 'codex-json') && buffer.trim()) {
          handleJsonLine(buffer);
        }
        if (backend.streamFormat === 'codex-json') appendActivity(`进程结束，退出码 ${code}`);
        ensurePlaceholderRemoved();
        if (!timedOut && code !== 0 && !this.sessionId && stderr && currentText.length === 0) {
          this.renderError(assistantContent, `${backend.label} 退出码 ${code}`, stderr.slice(0, 2000),
            `${backend.label} CLI 命令找不到 / 未登录 / 配额 / 网络`);
        }
        this.currentProcess = null;
        resolve();
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        clearInterval(heartbeat);
        ensurePlaceholderRemoved();
        this.renderError(assistantContent, `启动 ${backend.label} 失败`, err.message,
          `设置里改 ${backend.label} CLI 路径为绝对路径`);
        this.currentProcess = null;
        resolve();
      });
    });
  }

  shouldSkipGitRepoCheck(backendId, vaultRoot) {
    if (backendId !== 'codex') return false;
    const mode = this.plugin.settings.codexRepoMode || 'auto';
    if (mode === 'local') return true;
    if (mode === 'git') return false;
    return !this.findGitRoot(vaultRoot);
  }

  findGitRoot(startDir) {
    let dir = startDir;
    for (let i = 0; i < 12; i++) {
      if (!dir) return null;
      if (fs.existsSync(path.join(dir, '.git'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
    return null;
  }

  // ─── 流式事件分发 ──────────────────────────────────────

  handleCodexEvent(evt, ctx) {
    const { appendText, appendActivity, finishTextSegment } = ctx;
    const type = evt.type || evt.event || evt.kind || evt.msg?.type || 'event';

    if (evt.session_id && !this.sessionId) {
      this.sessionId = evt.session_id;
      this.updateHeaderSession(evt.session_id);
    }
    if (evt.model) this.updateModelDisplay(evt.model);

    const text =
      evt.delta ||
      evt.text ||
      evt.content ||
      evt.message?.content ||
      evt.msg?.content ||
      evt.item?.text ||
      '';

    if (typeof text === 'string' && text.trim()) {
      appendText(text, true);
      return;
    }

    if (type.includes('agent_message') && evt.message) {
      appendText(String(evt.message), true);
      return;
    }

    if (type.includes('reason') || type.includes('think')) {
      const summary = evt.summary || evt.text || evt.message || '正在推理';
      appendActivity(`思考：${String(summary).slice(0, 180)}`);
      return;
    }

    if (type.includes('tool') || type.includes('exec') || type.includes('command')) {
      const name = evt.name || evt.tool_name || evt.command || evt.cmd || type;
      appendActivity(`工具：${String(name).slice(0, 180)}`);
      return;
    }

    if (type.includes('error') || evt.error) {
      appendActivity(`错误：${String(evt.error || evt.message || type).slice(0, 220)}`);
      return;
    }

    if (type.includes('finish') || type.includes('complete') || type.includes('done')) {
      finishTextSegment();
      appendActivity('完成');
      return;
    }

    const keys = Object.keys(evt).filter(k => !['type', 'event', 'kind'].includes(k));
    const brief = keys.slice(0, 3).map(k => `${k}=${this.truncate(String(typeof evt[k] === 'object' ? JSON.stringify(evt[k]) : evt[k]), 80)}`).join(' · ');
    appendActivity(`${type}${brief ? ' · ' + brief : ''}`);
  }

  handleStreamEvent(evt, ctx) {
    const { assistantContent, ensurePlaceholderRemoved, appendText, finishTextSegment } = ctx;

    // system init
    if (evt.type === 'system' && evt.subtype === 'init') {
      this.sessionId = evt.session_id;
      this.updateHeaderSession(evt.session_id);
      if (evt.model) this.updateModelDisplay(evt.model);
      return;
    }

    // assistant message
    if (evt.type === 'assistant' && evt.message) {
      ensurePlaceholderRemoved();
      const content = evt.message.content || [];
      for (const item of content) {
        if (item.type === 'text') {
          appendText(item.text);
          if (this.currentTurn) this.currentTurn.text += item.text;
        } else if (item.type === 'thinking') {
          finishTextSegment();
          this.renderThinking(assistantContent, item.thinking);
        } else if (item.type === 'tool_use') {
          finishTextSegment();
          this.renderToolUse(assistantContent, item);
          // 累积到 currentTurn 用于持久化
          if (this.currentTurn) {
            this.currentTurn.toolCalls.push({
              id: item.id,
              name: item.name,
              input: item.input,
              result: null,        // 等 tool_result 时填
            });
          }
        }
      }
      this.scrollToBottom();
      return;
    }

    // user message (tool results)
    if (evt.type === 'user' && evt.message) {
      const content = evt.message.content || [];
      for (const item of content) {
        if (item.type === 'tool_result') {
          this.attachToolResult(item);
          // 把结果回填到 currentTurn 中对应的 tool_call
          if (this.currentTurn) {
            const tc = this.currentTurn.toolCalls.find(t => t.id === item.tool_use_id);
            if (tc) tc.result = this.toolResultSummary(item);
          }
        }
      }
      this.scrollToBottom();
      return;
    }

    // result (final cost)
    if (evt.type === 'result') {
      this.renderCost(evt);
      finishTextSegment();
      return;
    }
  }

  renderThinking(container, text) {
    if (!this.plugin.settings.showThinking) return;
    const t = container.createDiv({ cls: 'cb-thinking-card' });
    const header = t.createDiv({ cls: 'cb-thinking-header' });
    obsidian.setIcon(header.createSpan({ cls: 'cb-thinking-icon' }), 'brain');
    header.createSpan({ text: 'Thinking', cls: 'cb-thinking-label' });
    const body = t.createDiv({ cls: 'cb-thinking-body cb-collapsed' });
    body.setText(text || '');
    header.onclick = () => body.toggleClass('cb-collapsed', !body.hasClass('cb-collapsed'));
  }

  renderCost(evt) {
    if (!this.plugin.settings.showCost) return;
    const usage = evt.usage || {};
    const cost = evt.total_cost_usd;
    const duration = evt.duration_ms;
    this.lastCost = { input: usage.input_tokens, output: usage.output_tokens, cost, duration };

    this.costBarEl.empty();
    this.costBarEl.removeClass('cb-hidden');

    const tokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
    let text = `tokens: ${tokens.toLocaleString()}`;
    if (cost != null) text += ` · $${cost.toFixed(4)}`;
    if (duration) text += ` · ${(duration / 1000).toFixed(1)}s`;
    this.costBarEl.setText(text);
  }

  updateHeaderSession(sid) {
    if (this.headerSessionEl) {
      this.headerSessionEl.setText('•');
      this.headerSessionEl.title = 'session ' + sid;
    }
  }

  updateModelDisplay(name) {
    const el = this.containerEl.querySelector('.cb-model-name');
    if (el) el.setText(name);
  }

  // ─── v0.6: 持久化 session 到 vault ──────────────────────

  toolResultSummary(result) {
    let content = result.content;
    if (Array.isArray(content)) {
      content = content.map(c => typeof c === 'string' ? c : (c.text || JSON.stringify(c))).join('\n');
    }
    if (typeof content !== 'string') content = JSON.stringify(content);
    return {
      isError: !!result.is_error,
      preview: content.slice(0, 200),
      length: content.length,
    };
  }

  // 把 currentTurn 完成态 push 到 messages
  finalizeTurn() {
    if (this.currentTurn && (this.currentTurn.text || this.currentTurn.toolCalls.length > 0)) {
      this.messages.push({
        role: 'assistant',
        content: this.currentTurn.text,
        toolCalls: this.currentTurn.toolCalls,
        timestamp: this.currentTurn.timestamp,
        backend: this.currentBackend,
      });
    }
    this.currentTurn = null;
  }

  async saveSessionToVault() {
    if (!this.plugin.settings.autoSaveSessions) return;
    if (this.messages.length === 0) return;

    const vault = this.app.vault;
    const adapter = vault.adapter;
    const dir = this.plugin.settings.sessionsDir || SESSIONS_DIR;

    // 确保目录存在
    try {
      if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    } catch (e) {
      console.warn('[' + APP_NAME + '] 创建 sessions 目录失败', e);
    }

    // 文件名 (固定, 同一 session 重复写入覆盖)
    if (!this.sessionFile) {
      const date = new Date(this.startedAt).toISOString().slice(0, 10);
      const sid = (this.sessionId || 'local').slice(0, 8);
      const title = this.getAutoTitle();
      const slug = this.slugify(title).slice(0, 40);
      const fname = `${date}-${this.currentBackend}-${sid}${slug ? '-' + slug : ''}.md`;
      this.sessionFile = `${dir}/${fname}`;
    }

    // 序列化
    const md = this.serializeSession();

    try {
      await adapter.write(this.sessionFile, md);
      this.updateSavedIndicator(this.sessionFile);
    } catch (e) {
      console.error('[' + APP_NAME + '] 保存 session 失败', e);
      new obsidian.Notice('Session 保存失败: ' + e.message);
    }
  }

  getAutoTitle() {
    const firstUser = this.messages.find(m => m.role === 'user');
    if (!firstUser) return 'Untitled';
    return firstUser.content.split('\n')[0].slice(0, 60);
  }

  slugify(s) {
    if (!s) return '';
    return s
      .toLowerCase()
      .replace(/[　-鿿]/g, '')              // 去 CJK (保留 ASCII)
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-+/g, '-');
  }

  serializeSession() {
    const now = new Date();
    const title = this.getAutoTitle();
    const lastMsg = this.messages[this.messages.length - 1];
    const updatedAt = lastMsg ? new Date(lastMsg.timestamp).toISOString() : now.toISOString();
    const startedAt = new Date(this.startedAt).toISOString();

    let md = '---\n';
    md += `type: ai-session\n`;
    md += `title: ${JSON.stringify(title)}\n`;
    md += `backend: ${this.currentBackend}\n`;
    md += `model: ${this.getCurrentModel() || 'default'}\n`;
    md += `mode: ${this.currentMode}\n`;
    if (this.sessionId) md += `session_id: ${this.sessionId}\n`;
    md += `started: ${startedAt}\n`;
    md += `updated: ${updatedAt}\n`;
    md += `messages: ${this.messages.length}\n`;
    if (this.lastCost) {
      md += `tokens_in: ${this.lastCost.input || 0}\n`;
      md += `tokens_out: ${this.lastCost.output || 0}\n`;
      if (this.lastCost.cost != null) md += `cost_usd: ${this.lastCost.cost}\n`;
      if (this.lastCost.duration != null) md += `duration_ms: ${this.lastCost.duration}\n`;
    }
    md += `tags: [ai-session, ${this.currentBackend}]\n`;
    md += '---\n\n';
    md += `# ${title}\n\n`;

    for (const msg of this.messages) {
      const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString('zh-CN', { hour12: false }) : '';
      if (msg.role === 'user') {
        md += `## 🧑 User · ${time}\n\n${msg.content}\n\n`;
      } else if (msg.role === 'system') {
        md += `## ⚙ System · ${time}\n\n${msg.content}\n\n`;
      } else {
        md += `## 🤖 ${BACKENDS[msg.backend || this.currentBackend]?.label || 'AI'} · ${time}\n\n`;
        if (msg.content) md += msg.content + '\n\n';
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          md += '### 🔧 工具调用\n\n';
          for (const tc of msg.toolCalls) {
            md += `- **${tc.name}**`;
            const summary = this.toolCallSummaryText(tc);
            if (summary) md += `: \`${summary}\``;
            if (tc.result) {
              if (tc.result.isError) md += ' — ❌ 错误';
              else md += ` — ✓ ${tc.result.length} chars`;
            }
            md += '\n';
          }
          md += '\n';
        }
      }
    }

    md += '\n---\n\n';
    md += `> 由 [${APP_NAME}](../plugins/open-bridge/README.md) v${PLUGIN_VERSION} 自动生成\n`;
    return md;
  }

  toolCallSummaryText(tc) {
    const i = tc.input || {};
    if (tc.name === 'Read' || tc.name === 'Write' || tc.name === 'Edit' || tc.name === 'MultiEdit') return i.file_path || '';
    if (tc.name === 'Bash') return i.command || '';
    if (tc.name === 'Grep' || tc.name === 'Glob') return i.pattern || '';
    if (tc.name === 'WebFetch' || tc.name === 'WebSearch') return i.url || i.query || '';
    if (tc.name === 'Task') return i.description || i.subagent_type || '';
    return Object.keys(i)[0] ? `${Object.keys(i)[0]}: ${String(i[Object.keys(i)[0]]).slice(0, 40)}` : '';
  }

  // v0.8: 从 MD 文件 resume session
  async resumeFromFile(file) {
    this.stopCurrent();

    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter || {};
    const content = await this.app.vault.cachedRead(file);

    // 状态重置
    this.toolCards.clear();
    this.messagesContainer.empty();
    this.savedIndicatorEl?.empty();
    this.messages = [];
    this.currentTurn = null;

    // 从 frontmatter 还原状态
    this.sessionFile = file.path;
    this.sessionId = fm.session_id || null;
    if (fm.backend && BACKENDS[fm.backend]) {
      this.currentBackend = fm.backend;
      // 刷新 backend selector
      if (this.backendSelectorEl && this.backendSelectorEl.tagName === 'SELECT') this.backendSelectorEl.value = fm.backend;
      this.backendSelectorEl?.querySelectorAll?.('.cb-backend-btn').forEach(btn => {
        btn.toggleClass('cb-backend-active', btn.getAttribute('data-backend') === fm.backend);
      });
    }
    if (fm.mode && PERMISSION_MODES[fm.mode]) {
      this.currentMode = fm.mode;
      if (this.modeSelectorEl && this.modeSelectorEl.tagName === 'SELECT') this.modeSelectorEl.value = fm.mode;
      this.modeSelectorEl?.querySelectorAll?.('.cb-mode-btn').forEach(btn => {
        btn.toggleClass('cb-mode-active', btn.getAttribute('data-mode') === fm.mode);
      });
    }
    if (fm.started) this.startedAt = new Date(fm.started).getTime() || Date.now();

    // 更新 header
    if (this.sessionId) this.updateHeaderSession(this.sessionId);
    this.updateSavedIndicator(file.path);
    this.refreshModelDisplay();

    // 解析 body 消息
    const body = content.replace(/^---[\s\S]*?\n---\n?/, '').replace(/^#[^\n]*\n+/, '').trim();
    const parsed = this.parseMessagesFromMd(body);

    // 渲染
    for (const msg of parsed) {
      if (msg.role === 'user') {
        this.addUserMessage(msg.content);
      } else if (msg.role === 'system') {
        this.addSystemMessage(msg.content);
      } else {
        // assistant — 直接渲染到一个新 bubble
        const contentEl = this.createAssistantBubble();
        this.renderMarkdown(msg.content || '(无文本)', contentEl);
        this.currentTurn = null;
        this.messages.push({ ...msg, backend: this.currentBackend });
      }
    }

    // 把 welcome 区域移走 (避免叠加)
    this.removeWelcome();

    this.updateStatus(`📂 已恢复: ${file.basename} (${parsed.length} 条消息)` +
      (this.sessionId ? ` · 下条消息会 --resume ${this.sessionId.slice(0, 8)}` : ' · 无 session_id, 后续是新对话'));

    new obsidian.Notice(`恢复会话: ${fm.title || file.basename}`);
    this.scrollToBottom();
  }

  // 把 saved session MD 反解为消息数组
  parseMessagesFromMd(body) {
    const messages = [];
    // 按 "## " 拆 (^开头的)
    const parts = body.split(/\n## /).map((p, i) => i === 0 ? p.replace(/^## /, '') : p);

    for (const part of parts) {
      if (!part.trim()) continue;
      const firstNewline = part.indexOf('\n');
      const header = firstNewline > 0 ? part.slice(0, firstNewline) : part;
      const body = firstNewline > 0 ? part.slice(firstNewline + 1).trim() : '';

      let role;
      if (header.includes('🧑') || /^User\b/i.test(header)) role = 'user';
      else if (header.includes('🤖') || /^Claude\b|^AI\b|^Assistant\b|^Codex\b/i.test(header)) role = 'assistant';
      else if (header.includes('⚙') || /^System\b/i.test(header)) role = 'system';
      else continue;

      // 处理 footer (--- 之后是 footer, 不要)
      let content = body;
      const footerIdx = content.lastIndexOf('\n---\n');
      if (footerIdx > 0) content = content.slice(0, footerIdx);

      if (content) messages.push({ role, content });
    }
    return messages;
  }

  updateSavedIndicator(path) {
    if (!this.savedIndicatorEl) return;
    this.savedIndicatorEl.empty();
    this.savedIndicatorEl.addClass('cb-hidden');
    const link = this.savedIndicatorEl.createSpan({ cls: 'cb-saved-link', text: '' });
    link.title = path;
    link.onclick = () => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file) this.app.workspace.getLeaf('tab').openFile(file);
    };
  }

  // ─── 工具函数 ───────────────────────────────────────────

  async spawnAndCapture(cmd, args, options = {}) {
    return new Promise((resolve) => {
      try {
        const enhancedPath = [process.env.PATH || '', '/usr/local/bin', '/opt/homebrew/bin'].filter(Boolean).join(':');
        const p = spawn(cmd, args, { env: { ...process.env, PATH: enhancedPath }, shell: false });
        let out = '';
        const timeoutMs = options.timeoutMs || 15000;
        const timer = setTimeout(() => {
          try { p.kill('SIGTERM'); } catch (e) { /* noop */ }
          resolve((out || '') + `\nerror: command timed out after ${Math.round(timeoutMs / 1000)}s`);
        }, timeoutMs);
        p.stdout.on('data', c => out += c.toString());
        p.stderr.on('data', c => out += c.toString());
        p.on('close', () => { clearTimeout(timer); resolve(out); });
        p.on('error', e => { clearTimeout(timer); resolve(`error: ${e.message}`); });
      } catch (e) { resolve(`error: ${e.message}`); }
    });
  }

  renderError(container, title, detail, hint) {
    container.empty();
    container.createDiv({ text: `❌ ${title}`, cls: 'cb-error-title' });
    if (detail) container.createEl('pre', { text: detail, cls: 'cb-error-detail' });
    if (hint) container.createDiv({ text: `💡 ${hint}`, cls: 'cb-error-hint' });
  }

  clearMessages() {
    this.stopCurrent();
    this.messages = [];
    this.sessionId = null;
    this.toolCards.clear();
    this.messagesContainer.empty();
    this.costBarEl?.addClass('cb-hidden');
    this.headerSessionEl?.setText('•');
    if (this.headerSessionEl) this.headerSessionEl.title = 'new session';
    this.renderWelcome();
  }

  stopCurrent() {
    if (this.currentProcess) {
      try { this.currentProcess.kill('SIGTERM'); } catch (e) {}
      this.currentProcess = null;
    }
    this.isRunning = false;
  }

  updateStatus(text) { if (this.statusEl) this.statusEl.setText(text); }
  scrollToBottom() { this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight; }

  getVaultBasePath() {
    const adapter = this.app.vault.adapter;
    if (adapter && typeof adapter.getBasePath === 'function') return adapter.getBasePath();
    if (adapter && adapter.basePath) return adapter.basePath;
    return process.cwd();
  }
}

// ═════════════════════════════════════════════════════════════
// Settings Tab
// ═════════════════════════════════════════════════════════════

class ModelGatewaySetupModal extends obsidian.Modal {
  constructor(app, plugin, options = {}) {
    super(app);
    this.plugin = plugin;
    this.force = options.force === true;
    this.connectionMode = plugin.settings.modelGatewayConnectionMode || 'api';
    this.providerId = plugin.settings.modelGatewayPreset || 'custom';
    this.baseUrl = plugin.settings.modelGatewayBaseUrl || plugin.settings.companyCodexBaseUrl || '';
    this.model = plugin.settings.modelGatewayModel || plugin.settings.companyCodexModel || '';
    this.reasoning = plugin.settings.modelGatewayReasoning || plugin.settings.companyCodexReasoning || 'high';
    this.wireApi = plugin.settings.modelGatewayWireApi || 'responses';
    this.requiresAuth = plugin.settings.modelGatewayRequiresAuth !== false;
    this.apiKey = '';
    this.statusEl = null;
    this.apiOnlySettings = [];
    this.subscriptionOnlySettings = [];
    this.baseUrlInput = null;
    this.modelInput = null;
    this.wireApiDropdown = null;
    this.authToggle = null;
    this.apiKeySetting = null;
  }

  onOpen() {
    const { contentEl } = this;
    const tt = (key, vars) => this.plugin.t(key, vars);
    contentEl.empty();
    contentEl.addClass('cb-model-gateway-modal');

    contentEl.createEl('h2', { text: tt('modalGatewayTitle') });
    contentEl.createEl('p', {
      text: tt('modalGatewayIntro'),
      cls: 'setting-item-description'
    });

    new obsidian.Setting(contentEl)
      .setName(tt('modalConnectionMode'))
      .setDesc(tt('modalConnectionModeDesc'))
      .addDropdown(d => {
        d.addOption('subscription', tt('modalSubscriptionOption'));
        d.addOption('api', tt('modalApiOption'));
        d.setValue(this.connectionMode);
        d.onChange(v => {
          this.connectionMode = v;
          this.refreshModeUI();
        });
      });

    const subscriptionInfo = new obsidian.Setting(contentEl)
      .setName(tt('modalSubscriptionName'))
      .setDesc(tt('modalSubscriptionDesc'));
    this.subscriptionOnlySettings.push(subscriptionInfo);

    const presetSetting = new obsidian.Setting(contentEl)
      .setName(tt('modalPreset'))
      .setDesc(tt('modalPresetDesc'))
      .addDropdown(d => {
        for (const [key, preset] of Object.entries(MODEL_GATEWAY_PRESETS)) d.addOption(key, preset.label);
        d.setValue(this.providerId);
        d.onChange(v => this.applyPreset(v));
      });
    this.apiOnlySettings.push(presetSetting);

    const baseUrlSetting = new obsidian.Setting(contentEl)
      .setName(tt('modalBaseUrl'))
      .setDesc(tt('modalBaseUrlDesc'))
      .addText(t => {
        this.baseUrlInput = t;
        t.setPlaceholder('https://api.example.com/v1').setValue(this.baseUrl);
        t.onChange(v => { this.baseUrl = (v || '').trim(); });
      });
    this.apiOnlySettings.push(baseUrlSetting);

    new obsidian.Setting(contentEl)
      .setName(tt('modalModelName'))
      .setDesc(tt('modalModelNameDesc'))
      .addText(t => {
        this.modelInput = t;
        t.setPlaceholder('gpt-5.5 / qwen-max / deepseek-chat').setValue(this.model);
        t.onChange(v => { this.model = (v || '').trim(); });
      });

    const wireApiSetting = new obsidian.Setting(contentEl)
      .setName('Wire API')
      .setDesc(tt('modalWireApiDesc'))
      .addDropdown(d => {
        this.wireApiDropdown = d;
        d.addOption('responses', 'responses');
        d.addOption('chat', 'chat');
        d.setValue(this.wireApi || 'responses');
        d.onChange(v => { this.wireApi = v; });
      });
    this.apiOnlySettings.push(wireApiSetting);

    new obsidian.Setting(contentEl)
      .setName(tt('modalReasoning'))
      .setDesc(tt('modalReasoningDesc'))
      .addDropdown(d => {
        for (const value of ['high', 'medium', 'low', 'minimal']) d.addOption(value, value);
        d.setValue(this.reasoning || 'high');
        d.onChange(v => { this.reasoning = v; });
      });

    const authSetting = new obsidian.Setting(contentEl)
      .setName(tt('modalRequiresKey'))
      .setDesc(tt('modalRequiresKeyDesc'))
      .addToggle(t => {
        this.authToggle = t;
        t.setValue(this.requiresAuth);
        t.onChange(v => {
          this.requiresAuth = v;
          this.refreshAuthUI();
        });
      });
    this.apiOnlySettings.push(authSetting);

    this.apiKeySetting = new obsidian.Setting(contentEl)
      .setName('API Key')
      .setDesc(tt('modalApiKeyDesc'))
      .addText(t => {
        t.inputEl.type = 'password';
        t.setPlaceholder(tt('modalApiKeyPlaceholder'));
        t.onChange(v => { this.apiKey = (v || '').trim(); });
      });
    this.apiOnlySettings.push(this.apiKeySetting);
    this.refreshAuthUI();

    this.statusEl = contentEl.createDiv({ cls: 'setting-item-description cb-model-gateway-status' });
    this.refreshModeUI();

    const actions = contentEl.createDiv({ cls: 'cb-model-gateway-actions' });
    new obsidian.Setting(actions)
      .addButton(btn => btn
        .setButtonText(tt('modalLater'))
        .onClick(async () => {
          this.plugin.settings.modelGatewaySetupDismissed = true;
          this.plugin.settings.companyCodexSetupDismissed = true;
          await this.plugin.saveSettings();
          this.close();
        }))
      .addButton(btn => btn
        .setCta()
        .setButtonText(tt('modalSaveLogin'))
        .onClick(async () => this.submit(btn)));
  }

  applyPreset(providerId) {
    const preset = MODEL_GATEWAY_PRESETS[providerId] || MODEL_GATEWAY_PRESETS.custom;
    this.providerId = providerId;
    this.baseUrl = preset.baseUrl || '';
    this.model = preset.model || '';
    this.wireApi = preset.wireApi || 'responses';
    this.requiresAuth = preset.auth !== false;
    this.baseUrlInput?.setValue(this.baseUrl);
    this.modelInput?.setValue(this.model);
    this.wireApiDropdown?.setValue(this.wireApi);
    this.authToggle?.setValue(this.requiresAuth);
    this.refreshAuthUI();
  }

  refreshAuthUI() {
    if (!this.apiKeySetting?.settingEl) return;
    this.apiKeySetting.settingEl.toggleClass('cb-hidden', this.connectionMode !== 'api' || this.requiresAuth === false);
  }

  refreshModeUI() {
    const isApi = this.connectionMode === 'api';
    for (const setting of this.apiOnlySettings) setting.settingEl?.toggleClass('cb-hidden', !isApi);
    for (const setting of this.subscriptionOnlySettings) setting.settingEl?.toggleClass('cb-hidden', isApi);
    this.refreshAuthUI();
    if (this.statusEl) {
      this.statusEl.setText(isApi
        ? this.plugin.t('modalApiStatus')
        : this.plugin.t('modalSubStatus'));
      this.statusEl.removeClass('cb-model-gateway-error');
    }
  }

  onClose() {
    this.contentEl.empty();
  }

  async submit(btn) {
    const baseUrl = (this.baseUrl || '').trim();
    const model = (this.model || '').trim();
    const reasoning = (this.reasoning || 'high').trim();
    const wireApi = (this.wireApi || 'responses').trim();
    const apiKey = (this.apiKey || '').trim();

    if (this.connectionMode === 'subscription') {
      await this.submitSubscription(btn, model, reasoning);
      return;
    }

    if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
      this.setStatus(this.plugin.t('modalBaseUrlError'), true);
      return;
    }
    if (!model) {
      this.setStatus(this.plugin.t('modalModelError'), true);
      return;
    }
    if (this.requiresAuth && !apiKey) {
      this.setStatus(this.plugin.t('modalApiKeyError'), true);
      return;
    }

    btn.setDisabled(true);
    btn.setButtonText(this.plugin.t('modalConfiguring'));
    this.setStatus(this.plugin.t('modalWriting'), false);

    try {
      const result = await this.plugin.configureModelGateway({
        providerId: this.providerId,
        baseUrl,
        model,
        reasoning,
        wireApi,
        requiresAuth: this.requiresAuth,
        apiKey
      });
      const bad = /error:|exit code:\s*[1-9]/i.test(result.loginOut || '');
      if (bad) {
        this.setStatus(this.plugin.t('modalLoginMayFail'), true);
        new obsidian.Notice(this.plugin.t('noticeCodexLoginMayFail'));
        btn.setDisabled(false);
        btn.setButtonText(this.plugin.t('modalRetryLogin'));
        return;
      }
      new obsidian.Notice(this.plugin.t('noticeGatewayReady'));
      this.setStatus(this.plugin.t('modalWritten', { path: result.configPath }), false);
      setTimeout(() => this.close(), 900);
    } catch (e) {
      this.setStatus(e.message || String(e), true);
      btn.setDisabled(false);
      btn.setButtonText(this.plugin.t('modalSaveLogin'));
    }
  }

  async submitSubscription(btn, model, reasoning) {
    btn.setDisabled(true);
    btn.setButtonText(this.plugin.t('modalChecking'));
    this.setStatus(this.plugin.t('modalCheckingSubscription'), false);

    try {
      const result = await this.plugin.configureCodexSubscription({ model, reasoning });
      const bad = /not.*logged|not.*authenticated|error:|exit code:\s*[1-9]/i.test(result.loginOut || '');
      if (bad) {
        this.setStatus(this.plugin.t('modalSubscriptionNotLogged'), true);
        new obsidian.Notice(this.plugin.t('noticeRunCodexLogin'));
        btn.setDisabled(false);
        btn.setButtonText(this.plugin.t('modalRecheck'));
        return;
      }
      new obsidian.Notice(this.plugin.t('noticeSubscriptionReady'));
      this.setStatus(this.plugin.t('modalSubscriptionWritten', { path: result.configPath }), false);
      setTimeout(() => this.close(), 900);
    } catch (e) {
      this.setStatus(e.message || String(e), true);
      btn.setDisabled(false);
      btn.setButtonText(this.plugin.t('modalSaveCheck'));
    }
  }

  setStatus(text, isError) {
    if (!this.statusEl) return;
    this.statusEl.setText(text);
    this.statusEl.toggleClass('cb-model-gateway-error', !!isError);
  }
}

class ClaudeBridgeSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const tt = (key, vars) => this.plugin.t(key, vars);
    containerEl.empty();

    containerEl.createEl('h2', { text: APP_NAME + ' · v' + PLUGIN_VERSION });
    containerEl.createEl('p', {
      text: tt('settingIntro'),
      cls: 'setting-item-description'
    });

    new obsidian.Setting(containerEl)
      .setName(tt('settingLanguageName'))
      .setDesc(tt('settingLanguageDesc'))
      .addDropdown(d => {
        for (const [key, label] of Object.entries(LANGUAGE_OPTIONS)) d.addOption(key, label);
        d.setValue(normalizeLanguage(this.plugin.settings.uiLanguage));
        d.onChange(async v => {
          this.plugin.settings.uiLanguage = normalizeLanguage(v);
          await this.plugin.saveSettings();
          new obsidian.Notice(this.plugin.t('noticeLanguageChanged'));
          this.display();
        });
      });

    new obsidian.Setting(containerEl)
      .setName(tt('settingGatewayName'))
      .setDesc(tt('settingGatewayDesc'))
      .addButton(btn => btn
        .setCta()
        .setButtonText(tt('settingOpenWizard'))
        .onClick(() => this.plugin.openModelGatewaySetup()))
      .addButton(btn => btn
        .setButtonText(tt('settingShowNextLaunch'))
        .onClick(async () => {
          this.plugin.settings.modelGatewaySetupDismissed = false;
          this.plugin.settings.companyCodexSetupDismissed = false;
          await this.plugin.saveSettings();
          new obsidian.Notice(this.plugin.t('noticeSetupPromptRestored'));
        }));

    // ── 默认 backend ──
    new obsidian.Setting(containerEl)
      .setName(tt('settingDefaultBackend'))
      .setDesc(tt('settingDefaultBackendDesc'))
      .addDropdown(d => {
        for (const [k, info] of Object.entries(BACKENDS)) d.addOption(k, info.label);
        d.setValue(this.plugin.settings.defaultBackend || 'claude');
        d.onChange(async v => { this.plugin.settings.defaultBackend = v; await this.plugin.saveSettings(); });
      });

    new obsidian.Setting(containerEl)
      .setName(tt('settingDefaultMode'))
      .setDesc(tt('settingDefaultModeDesc'))
      .addDropdown(d => {
        for (const [k, info] of Object.entries(PERMISSION_MODES)) d.addOption(k, info.label);
        d.setValue(this.plugin.settings.defaultMode);
        d.onChange(async v => { this.plugin.settings.defaultMode = v; await this.plugin.saveSettings(); });
      });

    new obsidian.Setting(containerEl)
      .setName(tt('settingCodexRepoMode'))
      .setDesc(tt('settingCodexRepoModeDesc'))
      .addDropdown(d => {
        for (const k of Object.keys(CODEX_REPO_MODES)) d.addOption(k, this.plugin.getRepoModeLabel(k));
        d.setValue(this.plugin.settings.codexRepoMode || 'auto');
        d.onChange(async v => { this.plugin.settings.codexRepoMode = v; await this.plugin.saveSettings(); });
      });

    // ── 每个 backend 一组配置 ──
    if (!this.plugin.settings.backends) this.plugin.settings.backends = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.backends));

    for (const [key, info] of Object.entries(BACKENDS)) {
      const section = containerEl.createDiv({ cls: 'cb-settings-backend-section' });
      const title = section.createEl('h3');
      title.createSpan({ text: info.label + ' Backend' });
      const tag = title.createSpan({
        cls: 'cb-settings-backend-tag',
        text: info.streamFormat === 'claude-json' ? tt('backendFullTools') : tt('backendTextStream')
      });

      if (!this.plugin.settings.backends[key]) this.plugin.settings.backends[key] = { path: info.defaultPath, model: '', extraArgs: '' };
      const bcfg = this.plugin.settings.backends[key];

      new obsidian.Setting(section)
        .setName(tt('settingCliPath'))
        .setDesc(tt('settingCliPathDesc', { defaultPath: info.defaultPath || '(empty)' }))
        .addText(t => t.setPlaceholder(info.defaultPath || tt('cliPlaceholder')).setValue(bcfg.path)
          .onChange(async v => { bcfg.path = (v || '').trim(); await this.plugin.saveSettings(); }));

      new obsidian.Setting(section)
        .setName(tt('settingDefaultModel'))
        .setDesc(key === 'claude' ? tt('modelDescClaude') :
                 key === 'codex'  ? tt('modelDescCodex') : tt('modelDescOptional'))
        .addText(t => t.setPlaceholder(tt('modelPlaceholder')).setValue(bcfg.model)
          .onChange(async v => { bcfg.model = (v || '').trim(); await this.plugin.saveSettings(); }));

      new obsidian.Setting(section)
        .setName(tt('settingExtraArgs'))
        .setDesc(tt('settingExtraArgsDesc'))
        .addText(t => t.setPlaceholder('').setValue(bcfg.extraArgs || '')
          .onChange(async v => { bcfg.extraArgs = (v || '').trim(); await this.plugin.saveSettings(); }));
    }

    containerEl.createEl('h3', { text: tt('settingGeneral') });

    new obsidian.Setting(containerEl)
      .setName(tt('settingSessionsDir'))
      .setDesc(tt('settingSessionsDirDesc'))
      .addText(t => t.setPlaceholder(SESSIONS_DIR).setValue(this.plugin.settings.sessionsDir || SESSIONS_DIR)
        .onChange(async v => { this.plugin.settings.sessionsDir = (v || SESSIONS_DIR).trim(); await this.plugin.saveSettings(); }));

    new obsidian.Setting(containerEl)
      .setName(tt('settingAutoSave'))
      .setDesc(tt('settingAutoSaveDesc'))
      .addToggle(t => t.setValue(this.plugin.settings.autoSaveSessions !== false)
        .onChange(async v => { this.plugin.settings.autoSaveSessions = v; await this.plugin.saveSettings(); }));

    new obsidian.Setting(containerEl)
      .setName(tt('settingAttachmentsDir'))
      .addText(t => t.setPlaceholder('_shared/temp-claude-attachments').setValue(this.plugin.settings.attachmentsDir)
        .onChange(async v => { this.plugin.settings.attachmentsDir = v || '_shared/temp-claude-attachments'; await this.plugin.saveSettings(); }));

    new obsidian.Setting(containerEl)
      .setName(tt('settingShowThinking'))
      .setDesc(tt('settingShowThinkingDesc'))
      .addToggle(t => t.setValue(this.plugin.settings.showThinking)
        .onChange(async v => { this.plugin.settings.showThinking = v; await this.plugin.saveSettings(); }));

    new obsidian.Setting(containerEl)
      .setName(tt('settingShowCost'))
      .setDesc(tt('settingShowCostDesc'))
      .addToggle(t => t.setValue(this.plugin.settings.showCost)
        .onChange(async v => { this.plugin.settings.showCost = v; await this.plugin.saveSettings(); }));

    new obsidian.Setting(containerEl)
      .setName(tt('settingAutoCollapse'))
      .setDesc(tt('settingAutoCollapseDesc'))
      .addToggle(t => t.setValue(this.plugin.settings.autoCollapseToolBody)
        .onChange(async v => { this.plugin.settings.autoCollapseToolBody = v; await this.plugin.saveSettings(); }));

    containerEl.createEl('h3', { text: tt('settingCapabilities') });
    const ul = containerEl.createEl('ul', { cls: 'setting-item-description' });
    [
      tt('featureToolVisible') + ': Read / Edit / Write / Bash / Grep / Glob / TodoWrite / Task / WebFetch',
      tt('featureDiff') + ' (Edit / Write / MultiEdit)',
      tt('featureMultiTurn'),
      tt('featureModes'),
      tt('featureCost'),
      'Thinking blocks',
      'Code block copy button',
      'Attachments / drag and drop / slash commands / multiple panes'
    ].forEach(t => ul.createEl('li', { text: t }));
  }
}

// ═════════════════════════════════════════════════════════════
// SessionPickerModal · 历史 session 选择器 (v0.8)
// ═════════════════════════════════════════════════════════════

class SessionPickerModal extends obsidian.SuggestModal {
  constructor(app, plugin, targetView) {
    super(app);
    this.plugin = plugin;
    this.targetView = targetView;
    this.setPlaceholder('搜历史 AI 会话 (标题 / backend / 关键词)...');
    this.setInstructions([
      { command: '↑↓', purpose: '选择' },
      { command: '↵', purpose: 'Resume 到当前 pane' },
      { command: 'esc', purpose: '取消' },
    ]);
  }

  async getSuggestions(query) {
    const dir = this.plugin.settings.sessionsDir || SESSIONS_DIR;
    const folder = this.app.vault.getAbstractFileByPath(dir);
    if (!folder || !folder.children) return [];

    const files = folder.children
      .filter(f => f.extension === 'md' && f.basename !== 'INDEX')
      .sort((a, b) => (b.stat?.mtime || 0) - (a.stat?.mtime || 0));

    const items = files.map(f => {
      const cache = this.app.metadataCache.getFileCache(f);
      const fm = cache?.frontmatter || {};
      return {
        file: f,
        title: (fm.title || f.basename).replace(/^["']|["']$/g, ''),
        backend: fm.backend || 'unknown',
        model: fm.model || 'default',
        mode: fm.mode || '',
        messages: fm.messages || 0,
        cost: fm.cost_usd || 0,
        tokens: (fm.tokens_in || 0) + (fm.tokens_out || 0),
        updated: fm.updated || f.stat?.mtime,
        session_id: fm.session_id || null,
      };
    });

    if (!query) return items;
    const lower = query.toLowerCase();
    return items.filter(item =>
      item.title.toLowerCase().includes(lower) ||
      item.backend.toLowerCase().includes(lower) ||
      item.model.toLowerCase().includes(lower) ||
      item.file.basename.toLowerCase().includes(lower)
    );
  }

  renderSuggestion(item, el) {
    el.addClass('cb-picker-item');

    const title = el.createDiv({ cls: 'cb-picker-title', text: item.title });

    const meta = el.createDiv({ cls: 'cb-picker-meta' });
    const backendChip = meta.createSpan({ cls: `cb-picker-backend cb-picker-backend-${item.backend}` });
    backendChip.setText(BACKENDS[item.backend]?.label || item.backend);

    meta.createSpan({ text: ` · ${item.messages} 条`, cls: 'cb-picker-meta-text' });
    if (item.tokens) meta.createSpan({ text: ` · ${item.tokens.toLocaleString()} tokens`, cls: 'cb-picker-meta-text' });
    if (item.cost) meta.createSpan({ text: ` · $${item.cost.toFixed(4)}`, cls: 'cb-picker-meta-text' });
    if (item.session_id) {
      meta.createSpan({ text: ` · resumable`, cls: 'cb-picker-resumable' });
    } else {
      meta.createSpan({ text: ` · 仅历史 (无 session_id)`, cls: 'cb-picker-meta-text' });
    }

    const time = item.updated ? this.formatRelativeTime(new Date(item.updated)) : '';
    if (time) {
      const timeEl = meta.createSpan({ cls: 'cb-picker-time' });
      timeEl.setText(time);
    }
  }

  formatRelativeTime(date) {
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
    return date.toLocaleDateString('zh-CN');
  }

  async onChooseSuggestion(item) {
    await this.targetView.resumeFromFile(item.file);
  }
}

module.exports = ClaudeBridgePlugin;
