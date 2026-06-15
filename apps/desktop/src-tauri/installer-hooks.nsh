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

; 卸载收尾:询问是否一并删除本地数据(行情缓存可达数 GB)。默认保留,让用户自己拍板。
; 红线#4:凭据在 OS 钥匙串,不在数据目录,卸载本身不碰;此处只清 %APPDATA%\Sinan(缓存/库/日志/设置)。
!macro NSIS_HOOK_POSTUNINSTALL
  IfSilent sinan_keep_data
  MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除司南的本地数据?$\r$\n$\r$\n包含:行情缓存(可达数 GB)、训练模型、模拟盘记录、设置(位于 $APPDATA\Sinan)。$\r$\n数据源 token 存于系统钥匙串、不在此处,不受影响。$\r$\n$\r$\n选「否」可保留,重装后继续使用。" IDNO sinan_keep_data
  DetailPrint "删除本地数据 $APPDATA\Sinan…"
  RMDir /r "$APPDATA\Sinan"
  sinan_keep_data:
!macroend
