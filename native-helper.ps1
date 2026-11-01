# 共用本机辅助入口；TcpListener 不需要管理员 URL ACL，也不安装任何组件。
param([string]$SharedDir, [int]$DufsPort, [int]$Port, [int]$OwnerProcessId)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Web.Extensions
Add-Type -Path (Join-Path $PSScriptRoot 'native-helper.cs') -ReferencedAssemblies System.Windows.Forms,System.Web.Extensions
$server = New-Object LanNativeServer($SharedDir, $DufsPort, $Port)
$server.Start()
try {
    while (-not $server.IsStopped -and (Get-Process -Id $OwnerProcessId -ErrorAction SilentlyContinue)) {
        Start-Sleep -Milliseconds 500
    }
} finally {
    $server.Stop()
}
