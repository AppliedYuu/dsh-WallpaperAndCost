<#
  dsh-core-paste-fix / rollback.ps1

  从最近一次备份还原 DSH 客户端 bundle。
#>
[CmdletBinding()]
param(
  [string]$Target = "",
  [string]$Backup = ""
)

$ErrorActionPreference = "Stop"

function Get-DefaultTarget {
  $p = Join-Path $env:APPDATA "npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-client-ui-conversation\lib\client.js"
  if (Test-Path -LiteralPath $p) { return $p }
  throw "未找到默认目标：$p`n请用 -Target 指定。"
}

$target = if ($Target -ne "") { (Resolve-Path -LiteralPath $Target).Path } else { Get-DefaultTarget }

if ($Backup -ne "") {
  $source = (Resolve-Path -LiteralPath $Backup).Path
} else {
  $latest = Get-ChildItem -LiteralPath (Split-Path -Parent $target) -Filter ((Split-Path -Leaf $target) + ".bak-*") |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($null -eq $latest) { throw "没有找到备份（$target.bak-*），无法回滚。" }
  $source = $latest.FullName
}

Copy-Item -LiteralPath $source -Destination $target -Force
Write-Host "已回滚：$target"
Write-Host "来源：$source"
Write-Host "生效方式：DSH 客户端 HMR 会自动热替换；保险起见在页面按一次 Ctrl+F5。"
