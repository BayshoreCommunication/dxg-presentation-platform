# Starts the Room Agent watchdog at sign-in for the current (non-admin) user (G0-1 item 13).
# Run once from the room-agent folder:  powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$root\scripts\watchdog.mjs`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "DXG Room Agent" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Output "Registered 'DXG Room Agent' to start at sign-in for $env:USERNAME."
