# 人物连续性评测

这是离线计分工具：读取既有分析结果和固定原图，不发模型请求，不修改项目。

```powershell
npm.cmd run evaluate -- --project "data/projects/<项目ID>/project.json" --annotations benchmarks/identity-seed.json --output baseline.json
npm.cmd run evaluate -- --project "data/projects/<另一轮项目ID>/project.json" --annotations benchmarks/identity-seed.json --compare baseline.json --output candidate.json
```

项目 JSON 旁必须有原项目的 `images` 目录。每张样本按 JPEG 文件 SHA-256 匹配，图片缺失、重复、尚未读完或标注版本不同会明确报错。报告文件不能覆盖已有文件。

`identity-seed.json` 是从本地《小辣椒与萝卜头》第 36 集前三张正文目视核对得到的**标注草案**，仅覆盖女孩、橙猫和兜帽人物。它不是人工审核完成的标准答案，也不是整部作品的完整标注。原图不随仓库分发。用户核对标注框后可将 `annotationStatus` 改为 `human-reviewed`，并重新建立基线。

每个 `identity` 是标注者定义的稳定身份，不需要与模型 ID 或姓名相同；`regions` 是该人物在这一页的若干归一化头部区域。预测裁图中心唯一落入一个人物的区域时建立对应，多个区域有歧义时不强行分配。报告包含：

- `coverage`：标注的“人物 × 页”中，有裁图命中探针的比例。未命中可能是漏识别、缺少裁图或取景差异，**不能直接称为人物检测准确率**。
- `confirmedCoverage` 与 `pending`：已确认身份覆盖和待定情况，防止通过全部设为待定获得虚假的低错误率。
- `splitRate`：同一标注人物的已确认记录对，被分给不同 ID 的比例。
- `mergeRate`：不同标注人物的已确认记录对，被分给相同 ID 的比例。
- 分母为零的错误率返回 `null`，不当作零错误或满分；未标注的群众等不参与计分，也不据此计算假阳性率。
- `diagnostics.manualAppearances`：有人工归属或归并历史的出场数量。这类结果不能冒充原始模型成绩。
- `timing`：对应页面账本中的全部请求、用量与耗时，包含失败和重试，并列出模型及提示词哈希。混合配置、已有人工校正、不同运行范围的耗时不能直接当作版本提速结论。

旧项目没有独立出场记录时报告 `missing-appearance-records`，需要在独立的新项目中重新分析相同素材后再测。运行一次所得报告只是该轮结果；衡量新代码效果需对相同素材、相同标注执行新的分析轮次。此工具当前只评估局部身份连续性，尚未覆盖关系语义、转折判断或剧情理解质量。
