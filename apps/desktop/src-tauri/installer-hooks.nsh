; 司南 NSIS 安装钩子。
; 问题:重装/升级时若司南仍在运行(或上次没退干净的孤儿 sinan-engine),会锁住
;   sidecars/engine/_internal/VCRUNTIME140.dll 等文件 → 覆盖报 "Error opening file for writing"。
; 方案:安装/卸载前先杀掉主程序进程树(/T 连带其 spawn 的 engine/api sidecar)+ 任何孤儿引擎。
;   taskkill 在进程不存在时返回非零,nsExec 忽略即可(无副作用)。

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "关闭正在运行的司南与本地引擎…"
  nsExec::Exec 'taskkill /F /T /IM sinan-desktop.exe'
  nsExec::Exec 'taskkill /F /T /IM Sinan.exe'
  nsExec::Exec 'taskkill /F /T /IM sinan-engine.exe'
  Sleep 600
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "关闭正在运行的司南与本地引擎…"
  nsExec::Exec 'taskkill /F /T /IM sinan-desktop.exe'
  nsExec::Exec 'taskkill /F /T /IM Sinan.exe'
  nsExec::Exec 'taskkill /F /T /IM sinan-engine.exe'
  Sleep 600
!macroend
