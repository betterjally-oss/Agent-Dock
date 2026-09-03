# Agent Hook 安装说明

Agent Dock 只接收本机 `127.0.0.1:43822` 事件，不会自动改写 Agent 配置。先启动 Agent Dock，再在“设置 → Agent 来源”点击“复制配置”取得当前安装路径的示例。

## Codex

设置页复制的是一份完整的生命周期 Hook 配置。将它保存为：

```text
~/.codex/hooks.json
```

若该文件不存在，直接新建并粘贴；若已经存在，只把复制内容中 `hooks` 下的四个事件合并进去，文件最外层只能保留一个 `hooks` 对象。配置包含：

- `UserPromptSubmit` → `running`，不转发或保存用户 Prompt。
- `PermissionRequest` → `waiting`，只记录工具名称，不转发工具参数或命令。
- `PostToolUse` → `running`，用户处理审批后恢复运行状态。
- `Stop` → `completed`，只使用 Codex 提供的最后一条助手消息并截断为 280 字。

重启或新建一个 Codex 任务后，在 Codex 中打开 `/hooks`，检查并信任这四项用户 Hook。原先 `~/.codex/config.toml` 中的 `notify` 行可以保留：它继续兼容完成提醒与 Computer Use，Agent Dock 会按同一回合 ID 去重，不会生成两条成果。

## Claude Code

将复制的 `hooks` 对象合并到 `~/.claude/settings.json`。四个事件调用同一脚本：

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"/Applications/Agent Dock.app/Contents/Resources/app/scripts/claude-notify.js\"" }] }],
    "Notification": [{ "hooks": [{ "type": "command", "command": "node \"/Applications/Agent Dock.app/Contents/Resources/app/scripts/claude-notify.js\"" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node \"/Applications/Agent Dock.app/Contents/Resources/app/scripts/claude-notify.js\"" }] }],
    "StopFailure": [{ "hooks": [{ "type": "command", "command": "node \"/Applications/Agent Dock.app/Contents/Resources/app/scripts/claude-notify.js\"" }] }]
  }
}
```

- `UserPromptSubmit` → `running`，不转发或保存用户 Prompt。
- `Notification` 的 `permission_prompt`、`idle_prompt` 和 `elicitation_dialog` → `waiting`。
- `Stop` → `completed`，只读取转写末尾最后一条主线助手文本并截断为 280 字。
- `StopFailure` → `failed`；不从超时或停滞状态推测失败。

配置后可在 Claude Code 的 `/hooks` 菜单检查这四个事件是否已注册。

## WorkBuddy / CodeBuddy Code

需要 CodeBuddy Code v1.16 或更高版本。点击设置页 WorkBuddy 行的“复制配置”，把复制内容中的 `hooks` 合并到：

```text
~/.codebuddy/settings.json
```

文件最外层只能保留一个 `hooks` 对象；已有事件数组与 Agent Dock 的条目并存，不要覆盖自己的 Hook。接入事件为：

- `UserPromptSubmit`、`PostToolUse` → `running`，不转发 Prompt、工具输入或命令。
- `PermissionRequest`，以及明确的权限/闲置通知 → `waiting`。
- `Stop` → `completed`，只尝试从本机转写末尾提取最后一条主线助手文本。
- `StopFailure` → `failed`，只接受明确的异常终态。

CodeBuddy Code 不会热加载外部修改。重新启动任务后输入 `/hooks`，逐项检查并信任 Agent Dock Hook。官方格式见 [WorkBuddy Hooks Reference](https://www.workbuddy.ai/docs/cli/hooks)。

## Gemini CLI

点击设置页 Gemini CLI 行的“复制配置”，把复制内容中的 `hooks` 合并到：

```text
~/.gemini/settings.json
```

接入事件为：

- `BeforeAgent`、`AfterTool` → `running`，不转发 Prompt 或工具输入。
- `Notification` 中明确的 `ToolPermission` → `waiting`。
- `AfterAgent` → `completed`，只转发最终回复并由 Agent Dock 截断到 280 字。
- Gemini CLI 当前没有用于本接入的明确失败终态，因此不会显示或推测 `failed`。

重新启动 Gemini CLI 后输入 `/hooks panel` 检查配置；需要时使用 `/hooks enable-all` 启用。官方格式见 [Gemini CLI Hooks](https://geminicli.com/docs/hooks/)。

## GPT 或其他本机发送端

```bash
curl -X POST http://127.0.0.1:43822/events/gpt \
  -H 'Content-Type: application/json' \
  -d '{"version":1,"event":"completed","run_id":"demo-1","project":"demo","title":"任务完成","summary":"已生成结果","occurred_at":1788192000000}'
```

返回 HTTP `202` 表示事件已接收或已去重。`running` 和 `waiting` 必须提供稳定 `run_id`。摘要最多 280 字；`cwd` 只用于提取项目名，不会写入 `agent-runs.json`。

## 检查服务

```bash
curl http://127.0.0.1:43822/health
```

若端口已被占用，设置页会显示“端口不可用”；Agent Dock 不会抢占或关闭其他进程。
