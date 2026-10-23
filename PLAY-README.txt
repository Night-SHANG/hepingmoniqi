核平模拟器 · 小屋试验场 v0.2

Windows：先完整解压，再双击 START-WINDOWS.bat。
启动器使用已安装的 Python 3 启动仅本机访问的服务器，自动打开默认浏览器。游玩时保留命令窗口。
未安装 Python 3：https://www.python.org/downloads/windows/
macOS / Linux：在解压目录运行 python3 serve.py。
不要直接双击 index.html，三维模块需要本机 HTTP 服务。

拖动旋转镜头，滚轮缩放，点击目标瞄准，空格或发射按钮发射。
脉冲弹、冲击球：碰撞即爆。延时弹：发射后 3 秒爆炸，可弹跳；暂停和慢动作会影响计时。
瞄准点决定发射轨迹，不是固定爆点；房顶炸出洞后，后续弹体能够穿洞继续下落。
数字 1–3 切换已解锁工具。重建恢复小屋和庭院，不删除成长研究。
设置中有沙盒、静音、慢动作。存档仅在当前浏览器和网址下保留。

可破坏：小屋、树木、围栏、花盆、工作台、木箱、木堆。
不可破坏：地面、草、道路、湖泊和远景山体。本版不含挖地形或完整八章。
浏览器版；Android 尚未打包，真机性能与实际扬声器听感尚未验证。
测试详情见 RELEASE-NOTES.md。Three.js/OrbitControls 为 MIT，Rapier 为 Apache-2.0；音效为 CC0，见 audio/SOURCES.md。
