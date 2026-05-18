# AGENTS.md instructions for C:\Users\Administrator\Documents\image hang

## Local Skills

- Image tasks: use `C:\Users\Administrator\.codex\skills\gemai-image-generator` scripts. Text-to-image: `scripts\generate-image.ps1`; image edit: `scripts\edit-image.ps1`. They use `GEMAI_API_KEY` from env/user env; ask only if missing.
- `@chrome`: use Node REPL with trusted entrypoint `C:\Users\Administrator\.codex\.tmp\bundled-marketplaces\openai-bundled\plugins\chrome\scripts\browser-client.mjs`.

```js
const pluginRoot = "C:/Users/Administrator/.codex/.tmp/bundled-marketplaces/openai-bundled/plugins/chrome";
if (!globalThis.agent) {
  const { setupBrowserRuntime } = await import(pluginRoot + "/scripts/browser-client.mjs");
  await setupBrowserRuntime({ globals: globalThis });
}
if (!globalThis.browser) globalThis.browser = await agent.browsers.get("extension");
```

## Links

- 本地生成文件用 Windows 原生 Markdown 链接：`[文件名](<D:/path/文件名>)`；不要用 `/mnt/d/...`。

## Self-Improvement

On unexpected command/tool/API failure, user correction, outdated knowledge, or missing capability request, use `C:\Users\Administrator\.codex\skills\self-improving-agent\SKILL.md` and log only concise entries to `.learnings/`.

## Dependencies

- The user permits installing development dependencies as needed.
- Playwright is installed globally at `C:\Users\Administrator\AppData\Roaming\npm\node_modules`. In Node REPL sessions, add that directory with `js_add_node_module_dir` before importing `playwright`.
