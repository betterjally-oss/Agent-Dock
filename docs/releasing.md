# Agent Dock 发布流程

Agent Dock 使用 ad-hoc 签名，不进行 Apple 公证，也不上架 Mac App Store。用户首次启动时通过“系统设置 → 隐私与安全性 → 仍要打开”确认。

## 产物

```text
dist.noindex/Agent-Dock-<版本>-arm64.dmg
dist.noindex/mac-arm64/Agent Dock.app
```

`.noindex` 避免解包后的应用被 Spotlight 当成第二份安装。`afterPack` 会从内到外执行 ad-hoc 签名并用 `codesign --verify --deep --strict` 验证，失败时直接中断构建。

## 本地验证与发布

只在用户明确确认需要打包时执行：

```bash
npm ci
npm test
npm run build
```

正式发布标签必须与 `package.json` 版本一致：

```bash
version=$(node -p "require('./package.json').version")
git tag "v${version}"
git push origin "v${version}"
```

GitHub Actions 会安装锁定依赖、运行 `npm test`、生成并验证 DMG、生成 SHA-256，最后上传 `Agent-Dock-*` 产物。手动触发 workflow 只验证产物，不创建 Release。

## 发布前检查

- `package.json` 与 `package-lock.json` 版本一致，`CHANGELOG.md` 与 README 已同步。
- bundle ID 仍为 `com.xiaopu.agentdock`，安装包仍为 `Agent-Dock-*`。
- `scripts/codex-notify.js`、`scripts/claude-notify.js` 与 `scripts/agent-hook-notify.js` 位于 `build.files` 白名单。
- 不提交 `node_modules/`、`dist.noindex/`、`.env`、录音、剪贴板图片、本地工作区数据或凭据。
- 发布说明注明 macOS 13.0+、Apple Silicon 和首次“仍要打开”的操作。
- 未在实际发布仓库中配置独立 Agent Dock 下载地址前，README 不提供旧 TO-DO Panel 安装包链接。
