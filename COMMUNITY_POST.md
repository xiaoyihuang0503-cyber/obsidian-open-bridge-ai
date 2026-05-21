# Open Bridge：把 Obsidian 变成带上下文引用能力的 AI 工作台

我做了一个 Obsidian 插件，叫 **Open Bridge**。

它不是单纯的 AI 聊天窗口，而是一个把 Obsidian 笔记、文件、选中文本、AI 回复和本地/云端模型连接起来的上下文工作台。

很多时候，我们在知识库里问 AI，真正麻烦的不是“让 AI 回答”，而是让 AI 知道我们正在说什么。你可能刚刚切换了一个文档，选中了某一句话，或者想继续讨论上一轮 AI 生成的一段判断。传统聊天框很容易丢上下文，最后变成反复解释：“我说的是这个文件”“我指的是刚才那句话”。

Open Bridge 想解决的就是这个问题。

## 核心能力：引用上下文

Open Bridge 的核心设计是 **Context 引用**。

你可以把当前正在看的内容明确加入对话上下文：

- 从左侧文件列表右键，把一个文件或文件夹加入 Open Bridge 上下文
- 在 Markdown 文档中选中一句话或一段内容，加入 Open Bridge 上下文
- 在 AI 回复里引用全文、选中片段，或者悬浮某个段落后单独引用
- 这些内容会变成输入框上方的 Context chip
- 下一轮提问时，Open Bridge 会自动带上这些上下文

这意味着你可以直接问：

```text
总结这段。
把这句话改得更像产品文案。
基于刚才 AI 这段判断继续展开。
比较这两个文件里的信息差异。
```

不需要每次重新复制粘贴，也不需要解释“这个”到底指什么。

## 它适合谁

Open Bridge 适合长期在 Obsidian 里组织资料、写文档、做产品设计、写代码或维护知识库的人。

如果你的工作方式是：

- 文档很多，经常需要跨文件讨论
- 希望 AI 理解当前文档和选中段落
- 希望 AI 输出能继续被引用、修改、追问
- 希望会话沉淀回 Markdown，方便后续搜索和复盘
- 希望同时使用 Claude、Codex、本地模型或公司模型网关

那 Open Bridge 会比较顺手。

## 模型接入方式

Open Bridge 支持两类接入方式：

| 接入方式 | 适合场景 |
|---|---|
| 订阅账号 / Codex CLI 登录 | 已经登录 Codex App 或 Codex CLI 的用户 |
| API Key / 模型网关 | OpenAI、OpenRouter、LiteLLM、One API、Ollama、公司私有网关 |

它不会把 API Key 保存进 Vault，也不会写进插件设置。API Key 只用于本机 Codex 登录或网关配置。

## 当前功能

- Obsidian 内置 AI 聊天面板
- Claude / Codex / Custom CLI 后端
- Codex 订阅模式和 API 网关模式
- 文件、文件夹、选中文本加入上下文
- AI 回复全文/片段/段落引用为上下文
- 上下文 chip 管理
- 会话自动保存为 Markdown
- Codex 运行过程可见
- 模型网关配置向导
- Figma Bridge 状态入口

## 为什么做它

我自己的工作流里，Obsidian 是设计资产、项目文档、PRD、设计系统、业务输入和 AI 协作记录的中枢。

我希望 AI 不只是一个回答问题的聊天框，而是能围绕一个真实工作区持续协作：理解当前文件、理解选中的一句话、理解之前 AI 自己输出过的判断，并且把讨论结果沉淀回知识库。

Open Bridge 是这个方向的第一版。

## 项目地址

计划发布仓库：

```text
https://github.com/xiaoyihuang0503-cyber/obsidian-open-bridge
```

社区插件提交后，也会在 Obsidian Community Plugins 中搜索到 **Open Bridge**。
