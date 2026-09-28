# PowerPoint helper for the Room Agent (G0-1 fallback driver, D-002).
#
# Runs as its own process so that a PowerPoint that hangs inside a COM call blocks only
# this helper — the agent can time out, kill it, and recover. Protocol: one JSON request
# per line on stdin, one JSON reply per line on stdout, matched by "id".
#   {"id":1,"cmd":"start","file":"C:\\...\\deck.pptx","monitor":2,"presenterView":false}
#   {"id":2,"cmd":"status"}   {"id":3,"cmd":"stop"}   {"id":4,"cmd":"shutdown"}

$ErrorActionPreference = 'Stop'
$script:app = $null
$script:pres = $null

function Reply([int]$id, [hashtable]$body) {
  $body.id = $id
  [Console]::Out.WriteLine(($body | ConvertTo-Json -Compress -Depth 5))
  [Console]::Out.Flush()
}

function Get-App {
  if ($null -eq $script:app) {
    $script:app = New-Object -ComObject PowerPoint.Application
    $script:app.DisplayAlerts = 1        # ppAlertsNone: no dialog can stall a room PC
    $script:app.AutomationSecurity = 3   # msoAutomationSecurityForceDisable: macros never run
  }
  return $script:app
}

function Set-Monitor([int]$monitor) {
  $key = 'HKCU:\Software\Microsoft\Office\16.0\PowerPoint\Options'
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name DisplayMonitor -Value ("\\.\DISPLAY" + $monitor)
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $req = $line | ConvertFrom-Json
  try {
    switch ($req.cmd) {
      'start' {
        $clock = [Diagnostics.Stopwatch]::StartNew()
        Set-Monitor $req.monitor
        $app = Get-App
        # ReadOnly, not Untitled, no editing window.
        $script:pres = $app.Presentations.Open([string]$req.file, -1, 0, 0)
        $settings = $script:pres.SlideShowSettings
        if ($req.presenterView) { $settings.ShowPresenterView = -1 } else { $settings.ShowPresenterView = 0 }
        $null = $settings.Run()
        while ($app.SlideShowWindows.Count -lt 1) {
          if ($clock.ElapsedMilliseconds -gt 15000) { throw 'The slideshow did not start within 15 s.' }
          Start-Sleep -Milliseconds 50
        }
        $proc = Get-Process POWERPNT -ErrorAction SilentlyContinue | Select-Object -First 1
        Reply $req.id @{ ok = $true; firstSlideMs = $clock.ElapsedMilliseconds; pid = $(if ($proc) { $proc.Id } else { $null }) }
      }
      'status' {
        if ($null -eq $script:app -or $script:app.SlideShowWindows.Count -lt 1) {
          Reply $req.id @{ ok = $true; running = $false; responsive = $true }
        } else {
          $w = $script:app.SlideShowWindows.Item(1)
          Reply $req.id @{
            ok = $true; running = $true; responsive = $true
            slide = $w.View.CurrentShowPosition
            window = @{ left = $w.Left; top = $w.Top; width = $w.Width; height = $w.Height }
          }
        }
      }
      'stop' {
        if ($null -ne $script:app -and $script:app.SlideShowWindows.Count -gt 0) { $script:app.SlideShowWindows.Item(1).View.Exit() }
        if ($null -ne $script:pres) { $script:pres.Close(); $script:pres = $null }
        Reply $req.id @{ ok = $true }
      }
      'shutdown' {
        try { if ($null -ne $script:pres) { $script:pres.Close() } } catch {}
        try { if ($null -ne $script:app) { $script:app.Quit() } } catch {}
        if ($null -ne $script:app) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($script:app) }
        $script:pres = $null; $script:app = $null
        [GC]::Collect(); [GC]::WaitForPendingFinalizers()
        Reply $req.id @{ ok = $true }
      }
      default { Reply $req.id @{ ok = $false; code = 'unknown_command'; message = "Unknown command: $($req.cmd)" } }
    }
  } catch {
    Reply $req.id @{ ok = $false; code = 'com_error'; message = $_.Exception.Message }
  }
}
