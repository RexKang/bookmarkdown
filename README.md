# 📚 BookmarkDown

> **把书签存为 Markdown，把数据握在自己手中。**

**BookmarkDown** 是一个本地优先（Local-first）的书签管理工具。它不像传统书签管理器那样使用封闭数据库，而是将每一条书签直接保存为一个独立的 `.md` 文件，配以本地图片。你的数据永远只是**普通文件**，永远可读、可迁移、可版本控制（Git）。

![BookmarkDown 界面预览](https://via.placeholder.com/800x400?text=BookmarkDown+UI+Preview)

---

## ✨ 核心特性

- 📝 **纯 Markdown 存储**：每个书签都是一个独立的 `.md` 文件，包含 Frontmatter（元数据）和正文（笔记）。
- 🖼️ **本地图片管理**：缩略图和附件随书签一起保存在本地文件夹中，不依赖图床，永不失效。
- 🎴 **卡片式展示**：在网页中以网格卡片形式展示书签，标题、缩略图、描述一目了然。
- ✏️ **内联编辑与富文本**：支持在管理界面中直接编辑标题、缩略图、标签和正文内容（所见即所得或 Markdown 源码）。
- 🔍 **搜索与筛选**：按标题、标签或正文内容快速定位书签。
- 🏠 **完全离线**：无需互联网连接，无需注册账户，数据仅存在于你的磁盘上。
- 🔓 **零锁定（Zero Lock-in）**：即使停止使用本工具，你的数据依然是标准的 Markdown 和图片文件，可用任何文本编辑器打开。

---

## 🗂️ 数据架构（如何存储？）

项目采用最朴素的文件夹结构，所有数据一目了然：

```
BookmarkDown/
├── data/                         # 数据根目录
│   ├── bookmarks/               # 存放所有书签的 .md 文件
│   │   ├── 如何学习Python.md
│   │   ├── 2026年度技术趋势.md
│   │   └── 设计资源导航.md
│   └── images/                  # 存放所有本地图片
│       ├── python-cover.png
│       ├── tech-trends.jpg
│       └── design-tools.png
├── index.html                   # 前端管理界面
├── app.js                       # 核心业务逻辑
└── style.css                    # 界面样式
```

**单个书签文件（.md）示例：**

```markdown
---
title: 如何高效学习 Python
url: https://example.com/python-guide
thumbnail: /data/images/python-cover.png
tags:
  - 编程
  - Python
  - 教程
created: 2026-09-09
---

这是一份非常全面的 Python 学习路线图，涵盖了从基础语法到项目实战的全部内容。

## 我的学习笔记
- 第一周：熟悉基础语法
- 第二周：学习常用库（requests, pandas）
- 推荐配合《Python 编程：从入门到实践》这本书一起看。
```

---

## 🚀 快速开始

### 方式一：使用 Node.js 本地服务器（推荐）

这种方式提供完整的后端 API，支持文件读写、图片上传等所有功能。

```bash
# 1. 克隆仓库
git clone https://github.com/RexKang/bookmarkdown.git
cd bookmarkdown

# 2. 安装依赖
npm install

# 3. 启动本地服务
npm start

# 4. 在浏览器中打开
# 访问 http://localhost:3000
```

### 方式二：纯前端模式（轻量级）

如果你不想安装任何后端环境，可以使用浏览器的 `File System Access API` 直接打开文件夹。**注意**：此模式下部分功能（如自动文件写入）受浏览器安全策略限制，适合只读浏览或技术预览。

```bash
# 直接双击 index.html 或在浏览器中打开
# 然后通过“打开文件夹”按钮定位到你的数据目录
```

---

## 🛠️ 技术栈

| 模块 | 技术选型 | 说明 |
| :--- | :--- | :--- |
| **后端** | Node.js + Express | 提供 RESTful API，处理文件读写 |
| **前端** | Vanilla JS + HTML5 + CSS3 | 无重型框架，极致轻量，易于二次开发 |
| **Markdown 解析** | `marked` / `markdown-it` | 将 `.md` 渲染为 HTML，支持 GFM 语法 |
| **元数据解析** | `gray-matter` | 解析 Markdown 中的 YAML Frontmatter |
| **图片处理** | `multer` (上传) + `sharp` (可选压缩) | 处理图片存储和缩略图生成 |

---

## 🎯 开发路线图（Roadmap）

- [x] **Phase 1：基础架构**
  - [x] 定义数据存储结构（Markdown + 图片）
  - [x] 实现书签列表的卡片渲染
  - [x] 实现静态文件服务

- [ ] **Phase 2：核心功能**
  - [ ] 添加书签（自动生成 .md 文件）
  - [ ] 编辑书签（标题、URL、缩略图、正文）
  - [ ] 删除书签（同时删除关联图片）
  - [ ] 图片上传与本地存储

- [ ] **Phase 3：体验优化**
  - [ ] 实时搜索与标签过滤
  - [ ] 导入/导出（HTML 书签、JSON）
  - [ ] 从网页自动抓取元数据（Open Graph）

- [ ] **Phase 4：扩展生态**
  - [ ] 浏览器扩展（一键保存当前页面）
  - [ ] 暗色主题
  - [ ] 全文检索（基于 Markdown 内容）

---

## 🤝 贡献与反馈

BookmarkDown 完全开源，欢迎提交 Issue 和 Pull Request！

如果你有好的想法或遇到了 Bug，请直接在本仓库的 [Issues](https://github.com/RexKang/bookmarkdown/issues) 中提出。

---

## 📄 许可证

[AGPL-3.0 License](LICENSE) © 2026 RexKang

---

> **“数据即文件，自由即主权。”**
