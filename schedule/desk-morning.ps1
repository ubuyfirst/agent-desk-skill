# The morning desk for Windows (Task Scheduler). Keep this file ASCII: Windows PowerShell 5.1 reads it in the system code page.
#
# 1. Runs the desk's fresh read headless with Claude Code (claude -p), read-only outside the desk folder.
# 2. If that fails or runs past the time limit, falls back to the no-model refresh (refresh.js), so the page still renders.
# 3. Opens the page (and, if you name one, your editor) so the board is on screen before you sit down.
#
# Try it by hand first:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\schedule\desk-morning.ps1 -ProjectDir "C:\path\to\your-project"
#
# Then schedule it (run once, in PowerShell; change the path and the time):
#   $a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\path\to\your-project\schedule\desk-morning.ps1" -ProjectDir "C:\path\to\your-project"'
#   $t = New-ScheduledTaskTrigger -Daily -At 6:30am
#   $s = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun
#   Register-ScheduledTask -TaskName 'DeskMorning' -Action $a -Trigger $t -Settings $s
#
# The task runs only while you are signed in (it opens windows). -StartWhenAvailable runs a missed time when the machine is next on.
# Another agent CLI: replace the claude call below with your harness's headless mode (for example `codex exec`), with its own read-only settings.
param(
  [Parameter(Mandatory = $true)][string]$ProjectDir,  # your project folder (the one that holds desk\)
  [string]$DeskDir = 'desk',                           # the desk folder inside it
  [string]$ClaudePath = '',                            # leave empty to find claude on PATH
  [string]$EditorPath = '',                            # optional: an editor to open on the project, e.g. the path to Code.exe
  [int]$LimitMinutes = 45,
  [switch]$ShowOnly,                                   # skip the read, just open the page
  [switch]$NoShow                                      # do the read, open nothing
)

$ErrorActionPreference = 'Continue'
$Desk = Join-Path $ProjectDir $DeskDir
$Log  = Join-Path $Desk 'morning.log'
$Page = Join-Path $Desk 'index.html'

function Write-Log([string]$m) {
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm') + ' ' + $m
  Add-Content -Path $Log -Value $line -Encoding UTF8
}

function Show-Board {
  if ($EditorPath -and (Test-Path $EditorPath)) {
    Start-Process -FilePath $EditorPath -ArgumentList ('"' + $ProjectDir + '"')
    Start-Sleep -Seconds 10
  }
  if (Test-Path $Page) { Start-Process -FilePath $Page; Write-Log 'page on screen' } else { Write-Log 'no index.html to show' }
}

if (-not (Test-Path $Desk)) { Write-Error ('No desk folder at ' + $Desk); exit 1 }
if ($ShowOnly) { Show-Board; exit 0 }

Write-Log 'morning run started'
$ok = $false
$claude = $ClaudePath
if (-not $claude) { $c = Get-Command claude -ErrorAction SilentlyContinue; if ($c) { $claude = $c.Source } }

if (-not $claude -or -not (Test-Path $claude)) {
  Write-Log 'claude not found; falling back to refresh.js'
} else {
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
  $promptFile = Join-Path $PSScriptRoot 'morning-prompt.md'
  if (Test-Path $promptFile) { $prompt = Get-Content $promptFile -Raw -Encoding UTF8 } else { $prompt = 'Do the desk fresh read, unattended, read-only outside the desk folder. Send nothing.' }
  $prompt = 'Started by the scheduled job at ' + $stamp + '.' + [Environment]::NewLine + $prompt
  $inFile  = Join-Path $env:TEMP 'desk-morning-prompt.txt'
  $outFile = Join-Path $env:TEMP 'desk-morning-out.txt'
  $errFile = Join-Path $env:TEMP 'desk-morning-err.txt'
  Set-Content -Path $inFile -Value $prompt -Encoding UTF8

  # Read tools, writes only inside the desk folder, and the few shell commands the read needs.
  # Add your own read-only MCP tools here (tracker, calendar), e.g. 'mcp__linear__list_issues'.
  $allowed = @(
    'Read', 'Glob', 'Grep', 'Agent', 'Task', 'TodoWrite',
    ('Edit(' + $DeskDir + '/**)'), ('Write(' + $DeskDir + '/**)'),
    ('Bash(node ' + $DeskDir + '/refresh.js:*)'), ('Bash(node ' + $DeskDir + '/render.js:*)'),
    'Bash(gh pr view:*)', 'Bash(gh pr list:*)', 'Bash(gh issue list:*)',
    'Bash(git log:*)', 'Bash(git status:*)', 'Bash(date:*)', 'PowerShell(Get-Date*)'
  )
  function Quote([string]$s) { '"' + $s.Replace('"', '\"') + '"' }
  $argList = @('-p', '--permission-mode', 'dontAsk', '--output-format', 'text', '--allowedTools') + ($allowed | ForEach-Object { Quote $_ })

  $p = Start-Process -FilePath $claude -ArgumentList $argList -WorkingDirectory $ProjectDir -NoNewWindow -PassThru `
         -RedirectStandardInput $inFile -RedirectStandardOutput $outFile -RedirectStandardError $errFile
  $null = $p.Handle   # PS 5.1: without the handle cached, ExitCode comes back empty
  if ($p.WaitForExit($LimitMinutes * 60 * 1000)) {
    $p.WaitForExit()
    $ok = ($p.ExitCode -eq 0)
    Write-Log ('fresh read finished, exit ' + $p.ExitCode)
  } else {
    try { Stop-Process -Id $p.Id -Force } catch {}
    Write-Log ('fresh read passed the ' + $LimitMinutes + '-minute limit and was stopped')
  }
  foreach ($f in @($outFile, $errFile)) {
    if ((Test-Path $f) -and ((Get-Item $f).Length -gt 0)) {
      Add-Content -Path $Log -Value ('--- ' + (Split-Path $f -Leaf)) -Encoding UTF8
      Get-Content $f -Encoding UTF8 | Add-Content -Path $Log -Encoding UTF8
    }
  }
}

if (-not $ok) {
  Write-Log 'running refresh.js so the page still renders (its banner shows the judged read is old)'
  & node (Join-Path $Desk 'refresh.js') --data $Desk | Out-Null
}

if (-not $NoShow) { Show-Board }
Write-Log 'morning run done'
exit 0
