<#
  dsh-core-paste-fix / apply.ps1

  给 DSH Web 客户端 bundle 打"对话栏无法粘贴"补丁：
    - window 捕获层粘贴兜底（对抗扩展在 document 捕获阶段 stopPropagation）
    - 剪贴板只有 text/html 时用 DOMParser 提取文本兜底

  幂等：已打过补丁直接跳过；写入前自动备份；写入后做语法校验。
#>
[CmdletBinding()]
param(
  [string]$Target = "",
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$m) { if (-not $Quiet) { Write-Host $m } }

function Get-DefaultTarget {
  $p = Join-Path $env:APPDATA "npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-client-ui-conversation\lib\client.js"
  if (Test-Path -LiteralPath $p) { return $p }
  throw "未找到默认目标：$p`n请用 -Target 指定 dsh-client-ui-conversation\lib\client.js 的完整路径。"
}

$target = if ($Target -ne "") { (Resolve-Path -LiteralPath $Target).Path } else { Get-DefaultTarget }
if (-not (Test-Path -LiteralPath $target)) { throw "目标不存在：$target" }

$utf8 = New-Object System.Text.UTF8Encoding($false)
$text = [System.IO.File]::ReadAllText($target, $utf8)

if ($text.Contains("__dshComposerPasteHandled")) {
  Write-Info "已打过补丁，跳过：$target"
  exit 0
}

$anchorA = 'return Eu(editor.registerRootListener((root, prevRoot) => {'
if (-not $text.Contains($anchorA)) {
  throw "版本不匹配：找不到锚点 A（registerComposerKeymap 的 return）。该 DSH 版本的 composer 代码结构已变化，请手动核对后更新本脚本。"
}

$blockA = @'
			// Paste survives document-level blockers: extensions such as
			// "Enable Copy Paste - E.C.P" stop 'paste' in the CAPTURE phase on the
			// document, so the event never reaches this editor's root and Lexical
			// never dispatches PASTE_COMMAND — pasting into the composer silently
			// does nothing while typing still works (typing rides beforeinput and
			// the input event). Handling paste in the WINDOW capture phase, ahead
			// of every document-level listener, keeps the composer usable; the
			// marker keeps the root dispatch path from inserting the payload twice.
			const PASTE_HANDLED = "__dshComposerPasteHandled";
			const clipboardPayload = (clipboardData) => {
				const files = Array.from(clipboardData.items).filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter((file) => file !== null);
				let text = clipboardData.getData("text/plain");
				if (text === "") {
					// Rich sources (a web page, Office, an editor) may hand over
					// text/html with no text/plain; without this fallback the paste
					// was dropped as if the clipboard were empty.
					const html = clipboardData.getData("text/html");
					if (html !== "") {
						try {
							text = new DOMParser().parseFromString(html, "text/html").body?.textContent ?? "";
						} catch (error) {
							text = "";
						}
					}
				}
				return { files, text };
			};
			const applyComposerPaste = (event) => {
				const clipboardData = event?.clipboardData ?? null;
				if (clipboardData === null) return false;
				const { files, text } = clipboardPayload(clipboardData);
				if (files.length > 0) handlers.intakeFiles(files);
				if (text === "") {
					if (files.length === 0) return false;
					event.preventDefault();
					return true;
				}
				event.preventDefault();
				handlers.pasteText(text);
				return true;
			};
			const onWindowPaste = (event) => {
				if (event[PASTE_HANDLED] === true) return;
				const root = editor.getRootElement();
				if (root === null) return;
				const target = event.target;
				if (target !== root && !(target != null && root.contains(target))) return;
				if (applyComposerPaste(event)) event[PASTE_HANDLED] = true;
			};
			const pasteWindow = typeof window === "undefined" ? null : window;
			pasteWindow?.addEventListener("paste", onWindowPaste, true);
			const disposeWindowPaste = () => {
				pasteWindow?.removeEventListener("paste", onWindowPaste, true);
			};
'@

$blockB = @'
editor.registerCommand(Je$2, (event) => {
				if (event !== null && event[PASTE_HANDLED] === true) return true;
				const handled = applyComposerPaste(event);
				if (handled && event !== null) event[PASTE_HANDLED] = true;
				return handled;
			}, 4), disposeWindowPaste);
'@

# --- patch A: helpers + window-capture listener before the keymap return ---
# The anchor keeps its own leading indentation in the target text, so the block's
# FIRST line must arrive unindented (its later lines carry their own tabs).
$blockALines = @(($blockA -replace "`r`n", "`n") -split "`n")
$blockALines[0] = $blockALines[0].TrimStart("`t")
$blockAText = (($blockALines -join "`n").TrimEnd("`n")) + "`n"
# The anchor line's own indentation sits before the match; re-emit it for the
# anchor line itself, or `return Eu(...)` would end up flush left.
$anchorIndex = $text.IndexOf($anchorA)
$anchorIndent = ($text.Substring(0, $anchorIndex) -split "`n")[-1]
$patched = $text.Replace($anchorA, $blockAText + $anchorIndent + $anchorA)

# --- patch B: the PASTE_COMMAND registration body ---
$patternB = 'editor\.registerCommand\(Je\$2, \(event\) => \{[\s\S]*?\}, 4\)\);'
$regexB = New-Object System.Text.RegularExpressions.Regex($patternB)
$m = $regexB.Match($patched)
if (-not $m.Success) {
  throw "版本不匹配：找不到锚点 B（PASTE_COMMAND 注册块）。请手动核对后更新本脚本。"
}
$replacementB = ($blockB -replace "`r`n", "`n").TrimEnd("`n")
$patched = $patched.Substring(0, $m.Index) + $replacementB + $patched.Substring($m.Index + $m.Length)

# --- backup + write ---
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$target.bak-$stamp"
Copy-Item -LiteralPath $target -Destination $backup
[System.IO.File]::WriteAllText($target, $patched, $utf8)
Write-Info "已打补丁：$target"
Write-Info "备份：$backup"

# --- syntax check ---
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  & $node.Source --check $target 2>&1 | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) {
    Copy-Item -LiteralPath $backup -Destination $target -Force
    throw "语法校验失败，已自动回滚。"
  }
  Write-Info "语法校验通过。"
} else {
  Write-Info "未找到 node，跳过语法校验。"
}

Write-Info ""
Write-Info "生效方式：DSH 客户端 HMR 会 stat-poll bundle（约 500ms）并热替换该插件；"
Write-Info "保险起见在 DSH 页面按一次 Ctrl+F5 刷新。"
