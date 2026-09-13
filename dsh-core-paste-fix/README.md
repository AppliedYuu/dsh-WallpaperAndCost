# dsh-core-paste-fix — DSH 对话栏"无法粘贴"修复

## 症状

DSH Web GUI 的**对话输入栏（composer）**里：

- 键盘打字正常、能看到输入光标
- **Ctrl+V 完全没反应**，输入框里一个字都不出现
- **右键菜单 → 粘贴同样没反应**
- 但页面里别的普通输入框（textarea/input）粘贴正常

## 根因

浏览器扩展 **`Enable Copy Paste - E.C.P`**（KodeMuse，v2.0.0.3）在 `document` 上注册了
**捕获阶段**监听器，对一批事件无条件 `stopPropagation()`：

```js
// content_script/enable_copy.js（本机实装版本；aggressive_mode=true 分支）
['copy','cut','contextmenu','paste','keydown','keyup','selectstart','select',
 'dragstart','drag','mousedown','mouseup'].forEach(function (event) {
  document.addEventListener(event, function (e) { e.stopPropagation(); }, true);
});
```

`document` 是捕获路径上的第 2 个节点（window → document → html → … → target），
在这里停掉传播，**paste 事件永远到不了输入框元素**。

DSH 0.1.5-rc.x 的 composer 是 **Lexical contenteditable**，粘贴完全依赖
`PASTE_COMMAND` 送达编辑器根元素；事件送达不了 → 什么都不会发生。

- 为什么打字不受影响：打字走 `beforeinput` / `input`（不在扩展拦截列表里），
  浏览器原生默认行为照常发生。
- 为什么普通 textarea 能粘贴：粘贴的**默认行为**由浏览器在可编辑元素上执行，
  `stopPropagation()` 不取消默认行为。旧版 DSH 的 composer 正是 `<textarea>`，
  所以是**换用 Lexical contenteditable 之后**才坏的（"更新之后"）。
- 为什么右键菜单粘贴也不行：那是另一个 paste 事件，同样被拦在 document。

> 同类扩展（划词翻译、剪贴板管理、"解除复制限制"类）都可能这么干；
> E.C.P 把 `paste` 和 `keydown` 一起拦，所以症状最典型。

## 修复内容

在 composer 的按键映射注册处（`registerComposerKeymap`）增加：

1. **window 捕获阶段的 paste 监听**。window 在捕获路径最外层，先于任何
   document 级监听器执行，因此 document 上的 `stopPropagation()` 拦不住它。
   - 命中条件：paste 事件的 target 在**本编辑器根元素内**
   - 命中后调用与 `PASTE_COMMAND` **完全相同**的处理函数（`handlers.pasteText`）
   - 在事件对象上打标记 `__dshComposerPasteHandled`，根元素那条正常路径
     因此不会重复插入
   - 不使用 `stopPropagation`，页面里其它 document 级 paste 监听不受影响
   - 随 `registerComposerKeymap` 的 disposer 一起注销
2. **`text/plain` 为空时读 `text/html` 兜底**（DOMParser → `body.textContent`）。
   修掉第二个缺陷：剪贴板只有 HTML 时原来静默丢弃。

## 文件

| 文件 | 作用 |
|---|---|
| `apply.ps1` | 给 DSH 客户端 bundle 打补丁（幂等；写入前自动备份；写入后 `node --check` 校验，失败自动回滚） |
| `rollback.ps1` | 从最近一次备份还原 |
| `README.md` | 本文件 |

目标文件固定为：

```
%APPDATA%\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-client-ui-conversation\lib\client.js
```

## 用法

```powershell
# 打补丁（默认目标 = npm 全局安装的 DSH）
powershell -ExecutionPolicy Bypass -File .\apply.ps1

# 指定其它 DSH 安装
powershell -ExecutionPolicy Bypass -File .\apply.ps1 -Target "D:\...\dsh-client-ui-conversation\lib\client.js"

# 回滚
powershell -ExecutionPolicy Bypass -File .\rollback.ps1
```

生效方式：DSH 客户端 HMR 每约 500ms stat-poll 各 client bundle，改动会被识别为
新 rev 并热替换该插件；保险起见在 DSH 页面按一次 **Ctrl+F5**。

## 已应用记录（2026-09-13）

| 项 | 值 |
|---|---|
| 目标 | `%APPDATA%\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-client-ui-conversation\lib\client.js` |
| 备份 | `client.js.bak-20260913-153726`（原始 SHA256 `81314DFD…C37F`） |
| 补丁后 | SHA256 `ED9CDF3A…4C19`，`node --check` 通过 |
| 下发 rev | 旧 `8f6a253683f6` → 新 `c83710582988` |

`apply.ps1` 已用"原始备份 + 脚本"复跑验证：产物与线上补丁**逐字节一致**；
`rollback.ps1` 已验证可还原为原始字节。

### 验证结果（无头 Edge + 真实 DSH 实例）

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 无扩展拦截：Ctrl+V | ✅ | ✅（不重复插入） |
| **模拟 E.C.P 拦截：Ctrl+V** | ❌ 无反应 | ✅ 正常 |
| 多行文本 | ✅ | ✅ |
| 剪贴板只有 `text/html` | ❌ 无反应 | ✅ 粘出文字 |
| 键盘打字 | ✅ | ✅ 未受影响 |
| 页面 console 报错 | 无 | 无 |

## 注意事项

- 补丁写在 **npm 安装目录的已构建 bundle** 里，**DSH 升级会被覆盖**。
  升级后重新执行 `apply.ps1` 即可（幂等：已打过会跳过，不会重复注入）。
- `apply.ps1` 依赖两个锚点字符串；若 DSH 版本变化导致锚点消失，脚本会
  **直接报"版本不匹配"并退出**，不会写坏文件。
- 临时缓解（不改代码）：在扩展弹窗里**关掉 Enable 开关**（注意：只关
  Aggressive Mode **无效**，非激进分支同样拦 `paste`）。该扩展没有按站点白名单。
- 上游正解：composer 粘贴处理走 window 捕获层兜底，并在 `text/plain` 为空时
  读 `text/html` 兜底。
