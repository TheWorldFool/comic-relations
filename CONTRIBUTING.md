# Contributing / 参与贡献

This is an early release. Reproducible bug reports, usability feedback, and focused
pull requests are welcome. The current interface and analysis prompts are Chinese;
issues in Chinese or English are welcome.

这是早期版本，欢迎可复现的问题、使用体验反馈与聚焦单一改进的 PR。可以使用中文或英文。

## Development / 开发

```bash
npm ci
npm run dev
npm test
npm run build
```

The default tests use isolated fixtures and mock APIs. Do not add real API calls
to the default test suite. `npm run test:live` is optional and incurs API costs.

默认测试使用隔离数据与模拟接口。不要在默认测试中调用付费 API。
`npm run test:live` 是可选的付费验证。

## Useful reports / 有帮助的反馈

- Provide reproduction steps, expected behavior, OS/browser, Node.js version, and model name.
- For identity or stage errors, describe what was merged or split incorrectly and the relevant page range.
- Use original or authorized minimal examples. Remove keys, private paths, and sensitive story text from diagnostics.
- Do not commit `.env`, `data/`, or imported comic files.

- 说明复现步骤、预期结果、系统/浏览器、Node.js 版本和模型名称。
- 人物识别或阶段划分问题，请描述误合并、误拆分的具体情况及页码范围。
- 示例应为原创或有授权的最小素材；诊断信息须移除密钥、私人路径和敏感漫画文本。
- 不要提交 `.env`、`data/` 或导入的漫画文件。
