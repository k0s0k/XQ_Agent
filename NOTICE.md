# 来源与第三方说明

本项目由 [openJiuwen-ai/sciencediscovery](https://github.com/openJiuwen-ai/sciencediscovery) 的本地心桥改造版本整理而来，原始基线提交为 `cee1974d463136aa611234e3f8a915a7dc57ae88`。当前交付仅保留心理咨询辅助、主对话和知识库功能，已重新组织目录、命名、依赖和启动方式。

上游相关文件的版权声明为 `Copyright (C) 2026-2026 Huawei Technologies Co., Ltd`。沿用代码中的声明及 Apache License 2.0 文本予以保留，详见 [LICENSE](LICENSE)。本说明用于记录来源，不表示原作者对改造版本的认可。

## 运行依赖

| 软件                 | 版本    | 许可                               |
| -------------------- | ------- | ---------------------------------- |
| React / React DOM    | 19.2.7  | MIT                                |
| react-markdown       | 10.1.0  | MIT                                |
| Lucide React         | 1.26.0  | ISC；其中部分 Feather 图标使用 MIT |
| fflate               | 0.8.2   | MIT                                |
| PDF.js（pdfjs-dist） | 6.3.289 | Apache-2.0                         |

依赖的原始版权和完整许可随其安装包保留在 `node_modules` 中，准确的依赖版本及间接依赖以 `pnpm-lock.yaml` 为准。前端构建产物中的第三方许可见 `dist/.vite/license.md`。

PHQ-9、GAD-7 的来源与转载说明单独列在 [量表与临床来源](docs/clinical-notes.md)。
