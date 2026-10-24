# 核平：Godot 原生城市验证片

这是独立技术验证分支，不是完整游戏迁移，不替换 `main` 或既有浏览器版本。
保留同城 36 栋建筑、454,913 个源格的数据规模，采用区域毁伤与局部精细物理；
不承诺每个格子同时独立动态模拟。

## 验证环境

- 官方 Godot 4.7.1，内置 Jolt。
- 官方 Voxel Tools v1.7x GDExtension，固定校验值见 `tools/ci-bootstrap.py`。
- 原生体素组件负责地层存储/网格；同步精确盒碰撞与重要刚体由同一个 Jolt 世界负责。
- 城市数据 `data/city-cells.bin.gz` 是同一原数据的无损压缩，仅用于上传大小限制；
  CI 解压后强校验原始 SHA-256，未降低地图规模。

## 操作

右键拖动环绕，滚轮缩放，Home 恢复镜头。左键选择真实碰撞表面。
1 放置炸药，空格手动引爆；2 发射真实碰撞弹体；P 暂停/恢复；R 重建。
当前是验证界面和会话内状态，不读写旧游戏存档，不包含完整主模式成长系统。

## 证据与限制

工作流 `Godot native validation` 在公开仓库标准 Ubuntu/Windows runner 执行。
Ubuntu 使用 Xvfb + Mesa llvmpipe 软件渲染，实际输入、帧读回和截图可核验，
但不能据此声称玩家显卡帧率或低端电脑性能达标。
Windows 实际执行导出 EXE，验证扩展加载、城市就绪和正常退出；目前是 headless
启动冒烟，不是 Windows 可视交互验收。

2026-10-24 的 run 40107254747 两系统通过，Linux 56 项图形/输入检查通过。
首个视觉检查仍发现灯光过亮、简化爆炸表现不够清晰，后续限定视觉修正需要再次审图。
单次主爆计算约 126–139ms，尚未达到低于100ms的目标。

首次资源导入立即退出模式的上游异常及有界编辑器初始化替代方式，见
`docs/CI-IMPORT-BOUNDARY.md`。这不是宣称上游崩溃已根治。

## 许可

请保留 `vendor-notices/`、`assets/fonts/LICENSE.txt` 和 `assets/fonts/SOURCE.txt`。
最终可分发包必须附可直接读取的许可目录。来源、已核验内容和仍未知的精确
编译链边界见 `docs/VOXEL-THIRD-PARTY-NOTICES.md` 与
`docs/EXPORT-NOTICE-BOUNDARY.md`。本项目不宣称所有依赖均为 MIT。
