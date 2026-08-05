<#
    setup.ps1 — one-shot bootstrap for the Persian Claude Code wrapper.

    Assumes the target PC has NOTHING installed. Idempotent: every step checks
    before acting, so it is safe to re-run.

    IMPORTANT: this file must stay UTF-8 **with BOM**. Windows PowerShell 5.1
    reads a BOM-less script as the system ANSI codepage, which turns every
    Persian string below into mojibake.

    Usage:
        .\setup.ps1                       # normal, downloads what it needs
        .\setup.ps1 -Payload D:\usb       # offline: installers from a folder
        .\setup.ps1 -DeployRoot C:\tmp\x  # install somewhere else (testing)
        .\setup.ps1 -SkipSmokeTest        # skip the paid round-trip
#>
[CmdletBinding()]
param(
    [string]$Payload,
    [string]$DeployRoot = (Join-Path $env:LOCALAPPDATA 'persian-claude-gui'),
    [string]$ProjectDir = (Join-Path $env:USERPROFILE 'Documents\Claude'),
    [string]$ShortcutDir = [Environment]::GetFolderPath('Desktop'),
    [switch]$SkipSmokeTest
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonVersions = @('3.12.10', '3.12.9', '3.12.8')

# Prefer a log beside the installer, but fall back to TEMP: in the offline
# -Payload scenario this script runs from a USB stick that may be read-only.
$LogFile = Join-Path $Here 'setup-log.txt'
try {
    "=== setup run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" |
        Out-File $LogFile -Encoding utf8 -Append -ErrorAction Stop
} catch {
    $LogFile = Join-Path $env:TEMP 'persian-claude-setup-log.txt'
    "=== setup run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') (media not writable) ===" |
        Out-File $LogFile -Encoding utf8 -Append
}

function Log([string]$m) { $m | Out-File $LogFile -Encoding utf8 -Append }
function Step([string]$fa) { Write-Host ""; Write-Host "‣ $fa" -ForegroundColor Cyan; Log "STEP: $fa" }
function Ok([string]$fa)   { Write-Host "  ✓ $fa" -ForegroundColor Green;  Log "  OK: $fa" }
function Note([string]$fa) { Write-Host "  • $fa" -ForegroundColor Gray;   Log "  ..: $fa" }
function Warn([string]$fa) { Write-Host "  ! $fa" -ForegroundColor Yellow; Log "  WARN: $fa" }
function Die([string]$fa)  { Write-Host ""; Write-Host "✗ $fa" -ForegroundColor Red; Log "FAIL: $fa"; exit 1 }

Write-Host ""
Write-Host "نصب کلاد فارسی" -ForegroundColor White
Write-Host "این کار چند دقیقه طول می‌کشد. پنجره را نبندید." -ForegroundColor Gray

# ---------------------------------------------------------------- 1. probe
Step "بررسی سیستم"

foreach ($c in @('node', 'npm', 'python', 'py', 'winget', 'claude', 'code')) {
    $found = Get-Command $c -ErrorAction SilentlyContinue
    Log ("  probe {0,-8} => {1}" -f $c, $(if ($found) { $found.Source } else { 'NOT FOUND' }))
}

$edge = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($edge) { Ok "مرورگر Edge پیدا شد" }
else { Warn "Edge پیدا نشد — برنامه در مرورگر پیش‌فرض باز می‌شود" }
Log "  edge => $edge"

# ---------------------------------------------------------------- 2. python
Step "بررسی پایتون"

function Find-RealPython {
    # The Microsoft Store alias stub lives in WindowsApps and is NOT real
    # Python: it prints a "get it from the Store" message and exits.
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'),
        (Join-Path $env:ProgramFiles 'Python312\python.exe')
    )
    $onPath = Get-Command python -ErrorAction SilentlyContinue
    if ($onPath -and $onPath.Source -notlike '*WindowsApps*') { $candidates += $onPath.Source }

    foreach ($c in $candidates) {
        if (-not (Test-Path $c)) { continue }
        try {
            $v = & $c -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
            if ($v -match '^3\.(1[2-9]|[2-9]\d)') { return $c }
        } catch { }
    }
    return $null
}

$python = Find-RealPython
if ($python) {
    Ok "پایتون از قبل نصب است"
    Log "  python => $python"
} else {
    Note "پایتون نصب نیست — در حال نصب"

    $installer = $null
    if ($Payload) {
        $installer = Get-ChildItem -Path $Payload -Filter 'python-3.12*-amd64.exe' -ErrorAction SilentlyContinue |
                     Select-Object -First 1 -ExpandProperty FullName
        if ($installer) { Note "استفاده از فایل نصب روی حافظه جانبی" }
    }

    if (-not $installer) {
        # winget is absent on plenty of Windows 10 images, so direct download
        # is the primary path here, not a fallback.
        $installer = Join-Path $env:TEMP 'python-3.12-amd64.exe'
        $done = $false
        foreach ($v in $PythonVersions) {
            $url = "https://www.python.org/ftp/python/$v/python-$v-amd64.exe"
            try {
                Note "دانلود پایتون $v"
                Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing -TimeoutSec 300
                $done = $true; Log "  downloaded $url"; break
            } catch { Log "  download failed $v : $($_.Exception.Message)" }
        }
        if (-not $done) { Die "دانلود پایتون ناموفق بود. اینترنت را بررسی کنید یا از حالت آفلاین استفاده کنید." }
    }

    $p = Start-Process -FilePath $installer -Wait -PassThru -ArgumentList `
        '/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_test=0', 'Include_launcher=1'
    Log "  installer exit $($p.ExitCode)"
    if ($p.ExitCode -ne 0) { Die "نصب پایتون ناموفق بود (کد $($p.ExitCode))" }

    # PATH is not refreshed inside a running process, so re-detect by path.
    $python = Find-RealPython
    if (-not $python) { Die "پایتون نصب شد ولی پیدا نشد. سیستم را ری‌استارت کنید و دوباره اجرا کنید." }
    Ok "پایتون نصب شد"
}

$pythonw = Join-Path (Split-Path $python) 'pythonw.exe'
if (-not (Test-Path $pythonw)) { $pythonw = $python }
Log "  pythonw => $pythonw"

# ---------------------------------------------------------------- 3. claude
Step "بررسی کلاد کد"

$claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claude) {
    $local = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
    if (Test-Path $local) { $claude = $local }
}

if ($claude) {
    $ver = & $claude --version
    Ok "کلاد کد نصب است ($ver)"
    Log "  claude => $claude ($ver)"
} else {
    Note "کلاد کد نصب نیست — در حال نصب"
    try {
        Invoke-Expression (Invoke-RestMethod 'https://claude.ai/install.ps1')
    } catch {
        Die "نصب کلاد کد ناموفق بود: $($_.Exception.Message)"
    }
    $claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
    if (-not $claude) {
        $local = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
        if (Test-Path $local) { $claude = $local }
    }
    if (-not $claude) { Die "کلاد کد نصب شد ولی پیدا نشد. سیستم را ری‌استارت کنید و دوباره اجرا کنید." }
    Ok "کلاد کد نصب شد"
}

# ---------------------------------------------------------------- 4. deploy
Step "کپی برنامه"

New-Item -ItemType Directory -Force -Path $DeployRoot | Out-Null
foreach ($item in @('server.py', 'smoke_test.py', 'static', 'assets')) {
    $src = Join-Path $Here $item
    if (-not (Test-Path $src)) { Die "فایل $item پیدا نشد — بسته نصب ناقص است" }
    Copy-Item -Path $src -Destination $DeployRoot -Recurse -Force
}
Ok "برنامه در $DeployRoot کپی شد"
Log "  deployed to $DeployRoot"

$serverPy = Join-Path $DeployRoot 'server.py'

# A space in $DeployRoot or $python used to disable tool approvals silently (the
# CLI split the PreToolUse hook command on whitespace). That hook is gone as of
# 2026-08-05 — approvals ride the CLI's own stdin pipe now — so the 8.3
# short-name check that guarded it was deleted with it.

# ---------------------------------------------------------------- 5. launcher
Step "ساخت میان‌بر"

New-Item -ItemType Directory -Force -Path $ProjectDir | Out-Null

# Absolute interpreter path, always: `python` on PATH is shadowed by the Store
# alias stub, and PATH changes do not reach an already-running shell.
$runVbs = Join-Path $DeployRoot 'run.vbs'
$vbs = @"
' Launches the wrapper with no console window. Generated by setup.ps1 -
' the interpreter path is baked in deliberately; never rely on PATH.
Set sh = CreateObject("WScript.Shell")
sh.Run """$pythonw"" ""$serverPy"" --cwd ""$ProjectDir""", 0, False
"@
# UTF-16LE with BOM: wscript reads a BOM-less .vbs as the ANSI codepage, which
# would mangle these paths on a machine whose Windows username is not ASCII -
# a Persian username is entirely plausible here.
[System.IO.File]::WriteAllText($runVbs, $vbs, (New-Object System.Text.UnicodeEncoding($false, $true)))
Ok "اجرا‌کننده ساخته شد"

New-Item -ItemType Directory -Force -Path $ShortcutDir | Out-Null
$shortcut = Join-Path $ShortcutDir 'کلاد فارسی.lnk'
# WshShell.Save() marshals the target path through the system's ANSI codepage
# (a legacy COM Automation quirk) — on a non-Persian codepage this mangles a
# Persian filename to "????.lnk" and Save() throws FileNotFoundException. So
# build under an ASCII name first (Save() is fine with that), then rename to
# the Persian name via Rename-Item, a plain NTFS op with no ANSI round-trip.
$shortcutTmp = Join-Path $ShortcutDir 'claude-launcher.lnk'
$wsh = New-Object -ComObject WScript.Shell
$lnk = $wsh.CreateShortcut($shortcutTmp)
$lnk.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$lnk.Arguments = """$runVbs"""
$lnk.WorkingDirectory = $DeployRoot
$lnk.IconLocation = (Join-Path $DeployRoot 'assets\icon.ico')
# ASCII on purpose: the .lnk Description round-trips through an ANSI codepage
# and silently rewrites Persian ی (U+06CC) as Arabic ي. The shortcut's *name*
# is the label the colleague reads, and NTFS stores that as real UTF-16.
$lnk.Description = 'Persian front-end for Claude Code (independent project)'
$lnk.Save()
Rename-Item -Path $shortcutTmp -NewName (Split-Path $shortcut -Leaf) -Force
# An install from before the rebrand left «کلود.lnk» on the desktop. setup.ps1
# has to stay idempotent, and two icons for one app is worse than none.
$legacy = Join-Path $ShortcutDir 'کلود.lnk'
if (Test-Path $legacy) { Remove-Item $legacy -Force; Log '  removed pre-rebrand shortcut' }
Ok "میان‌بر «کلاد فارسی» روی دسکتاپ ساخته شد"
Log "  shortcut => $shortcut"

# ---------------------------------------------------------------- 6. smoke
if ($SkipSmokeTest) {
    Step "آزمایش نهایی رد شد"
} else {
    Step "آزمایش نهایی"
    Note "یک پیام آزمایشی به کلاد کد فرستاده می‌شود"

    $env:PYTHONIOENCODING = 'utf-8'
    $smoke = Join-Path $DeployRoot 'smoke_test.py'
    & $python $smoke 2>&1 | ForEach-Object { Log "  smoke: $_" }
    $smokeOk = $LASTEXITCODE -eq 0

    if ($smokeOk) {
        Ok "آزمایش موفق بود"
    } else {
        Warn "آزمایش ناموفق بود"
        Write-Host ""
        Write-Host "  احتمالاً باید یک بار وارد حساب کلاد کد شوید." -ForegroundColor Yellow
        Write-Host "  این تنها کاری است که باید دستی انجام دهید:" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "    1. پنجره خط فرمان را باز کنید" -ForegroundColor White
        Write-Host "    2. دستور زیر را بزنید و مراحل ورود را کامل کنید:" -ForegroundColor White
        Write-Host "       claude" -ForegroundColor Cyan
        Write-Host "    3. سپس همین فایل نصب را دوباره اجرا کنید" -ForegroundColor White
        Write-Host ""
        Log "  smoke test failed (exit $LASTEXITCODE)"
    }
}

# ---------------------------------------------------------------- done
Write-Host ""
Write-Host "نصب تمام شد." -ForegroundColor Green
Write-Host "برای شروع، روی آیکون «کلاد فارسی» در دسکتاپ دوبار کلیک کنید." -ForegroundColor White
Write-Host "پوشه پروژه: $ProjectDir" -ForegroundColor Gray
Write-Host "گزارش کامل: $LogFile" -ForegroundColor Gray
Write-Host ""
Log "=== setup finished ==="
