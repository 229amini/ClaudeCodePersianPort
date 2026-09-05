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
        # Say why the offline folder was ignored. Silently falling through to a
        # download means a blocked network reports "دانلود ناموفق" when the real
        # problem is a wrong -Payload path.
        if (-not (Test-Path $Payload)) {
            Warn "پوشه آفلاین پیدا نشد: $Payload"
        } else {
            $installer = Get-ChildItem -Path $Payload -Filter 'python-3.12*-amd64.exe' -ErrorAction SilentlyContinue |
                         Select-Object -First 1 -ExpandProperty FullName
            if ($installer) { Note "استفاده از فایل نصب روی حافظه جانبی" }
            else { Warn "فایل نصب پایتون در پوشه آفلاین نبود" }
        }
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
    # 3010 is ERROR_SUCCESS_REBOOT_REQUIRED — installed, not failed. Treating it
    # as failure would abort a bootstrap that actually worked.
    if ($p.ExitCode -eq 3010) { Warn "پایتون نصب شد؛ ویندوز نیاز به ری‌استارت دارد" }
    elseif ($p.ExitCode -ne 0) { Die "نصب پایتون ناموفق بود (کد $($p.ExitCode))" }

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
    # Run the vendor installer in a CHILD powershell, never Invoke-Expression.
    # IEX executes in *this* scope, and claude.ai/install.ps1 (read 2026-08-05)
    # both calls `exit 1` on every failure path — verified to terminate the
    # calling script outright, catch block and all — and sets
    # `Set-StrictMode -Version Latest`, which would then govern every later step
    # here. A child process can leak neither.
    # EAP is dropped to Continue only around the call: PowerShell 5.1 turns a
    # native command's stderr into a *terminating* NativeCommandError when EAP
    # is Stop, so `2>&1` on a failing installer would kill setup.ps1 too.
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex" 2>&1 |
        ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray; Log "  claude-install: $_" }
    $installCode = $LASTEXITCODE
    $ErrorActionPreference = $eap
    Log "  claude installer exit $installCode"
    if ($installCode -ne 0) {
        Die "نصب کلاد کد ناموفق بود (کد $installCode). اینترنت را بررسی کنید — ممکن است این سرویس در کشور شما در دسترس نباشد. گزارش کامل: $LogFile"
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
foreach ($item in @('server.py', 'smoke_test.py', 'test_no_console.py', 'static',
                    'static-terminal', 'assets')) {
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

# A generated run.vbs used to live here, launched through wscript.exe, its whole
# body one sh.Run(..., 0, False) to suppress the console window. On a clean
# Windows 11 image (§0.5 sandbox, 2026-08-07) the shortcut died on
# «There is no script engine for file extension ".vbs"» — VBScript is deprecated
# and its engine is now a Feature-on-Demand that fresh installs may not carry.
# pythonw.exe is a GUI-subsystem binary and allocates no console of its own, so
# the shortcut points straight at it: the scripting host, the extra generated
# file and its UTF-16LE-BOM rule all disappear together.
# ponytail: if pythonw.exe were absent, $pythonw fell back to python.exe above
# and a console would appear. CPython's Windows installer always ships pythonw —
# not worth a second launcher.
$legacyVbs = Join-Path $DeployRoot 'run.vbs'
if (Test-Path $legacyVbs) { Remove-Item $legacyVbs -Force; Log '  removed legacy run.vbs' }

New-Item -ItemType Directory -Force -Path $ShortcutDir | Out-Null

# Two shortcuts, one engine: the web shell and the terminal-shaped shell are the
# same server.py behind --ui. Every quirk below cost a debugging session, so the
# two shortcuts are built by one function rather than two copies of it.
function New-AppShortcut {
    param([string]$LinkName, [string]$Arguments)
    $shortcut = Join-Path $ShortcutDir $LinkName
    # WshShell.Save() marshals the target path through the system's ANSI codepage
    # (a legacy COM Automation quirk) — on a non-Persian codepage this mangles a
    # Persian filename to "????.lnk" and Save() throws FileNotFoundException. So
    # build under an ASCII name first (Save() is fine with that), then rename to
    # the Persian name via Rename-Item, a plain NTFS op with no ANSI round-trip.
    $shortcutTmp = Join-Path $ShortcutDir 'claude-launcher.lnk'
    $wsh = New-Object -ComObject WScript.Shell
    $lnk = $wsh.CreateShortcut($shortcutTmp)
    $lnk.TargetPath = $pythonw
    $lnk.Arguments = $Arguments
    $lnk.WorkingDirectory = $DeployRoot
    $lnk.IconLocation = (Join-Path $DeployRoot 'assets\icon.ico')
    # ASCII on purpose: the .lnk Description round-trips through an ANSI codepage
    # and silently rewrites Persian ی (U+06CC) as Arabic ي. The shortcut's *name*
    # is the label the colleague reads, and NTFS stores that as real UTF-16.
    $lnk.Description = 'Persian front-end for Claude Code (independent project)'
    $lnk.Save()
    # -Force does NOT make Rename-Item overwrite an existing destination (it only
    # unblocks read-only/hidden sources) — a second setup run threw "Cannot create a
    # file when that file already exists" and left the ASCII temp .lnk behind, two
    # icons for one app. Drop the old shortcut first; setup.ps1 must re-run clean.
    if (Test-Path $shortcut) { Remove-Item $shortcut -Force }
    Rename-Item -Path $shortcutTmp -NewName (Split-Path $shortcut -Leaf)
    return $shortcut
}

$shortcut = New-AppShortcut 'کلاد فارسی.lnk' """$serverPy"" --cwd ""$ProjectDir"""
$shortcutTui = New-AppShortcut 'کلاد فارسی — ترمینال.lnk' """$serverPy"" --cwd ""$ProjectDir"" --ui terminal"
# An install from before the rebrand left «کلود.lnk» on the desktop. setup.ps1
# has to stay idempotent, and two icons for one app is worse than none.
$legacy = Join-Path $ShortcutDir 'کلود.lnk'
if (Test-Path $legacy) { Remove-Item $legacy -Force; Log '  removed pre-rebrand shortcut' }
Ok "میان‌برهای «کلاد فارسی» روی دسکتاپ ساخته شد"
Log "  shortcut => $shortcut"
Log "  shortcut => $shortcutTui"

# ------------------------------------------------------- 5.5 launcher check
# The shortcut runs pythonw.exe, and nothing else here ever does. Both launcher
# bugs so far (the missing VBScript engine, then sys.stderr being None under
# pythonw) were invisible to every check that came before and shipped a window
# showing an error page. Free, no CLI turn, and independent of login — so it
# runs before the paid smoke test and gates it.
Step "آزمایش اجرای برنامه"

$env:PYTHONIOENCODING = 'utf-8'
$eap = $ErrorActionPreference           # native stderr is terminating under Stop
$ErrorActionPreference = 'Continue'
# test_no_console.py asserts a 403 on an unauthenticated GET and never reads a
# static file (its own docstring says so) - the same edition-agnostic check
# either way, so running it once per --ui edition tested nothing twice. One
# run proves pythonw.exe answers HTTP at all; the real per-edition risk (a
# static folder that failed to deploy) is checked directly below instead.
$launcherOk = $true
& $python (Join-Path $DeployRoot 'test_no_console.py') 2>&1 |
    ForEach-Object { Log "  launcher: $_" }
if ($LASTEXITCODE -ne 0) { $launcherOk = $false }
$ErrorActionPreference = $eap

foreach ($edition in @('static', 'static-terminal')) {
    $indexFile = Join-Path $DeployRoot "$edition\index.html"
    if (-not (Test-Path $indexFile)) {
        Die "فایل $indexFile پیدا نشد — بسته نصب ناقص است"
    }
}

if ($launcherOk) {
    Ok "برنامه بدون پنجره خط فرمان اجرا شد"
} else {
    Warn "برنامه اجرا نشد"
    Write-Host ""
    Write-Host "  میان‌بر ساخته شد ولی برنامه بالا نیامد." -ForegroundColor Yellow
    Write-Host "  لطفاً این فایل گزارش را برای سازنده بفرستید:" -ForegroundColor Yellow
    Write-Host "    $LogFile" -ForegroundColor Cyan
    Write-Host ""
}

# ---------------------------------------------------------------- 6. smoke
if (-not $launcherOk) {
    Step "آزمایش نهایی رد شد"
} elseif ($SkipSmokeTest) {
    Step "آزمایش نهایی رد شد"
} else {
    Step "آزمایش نهایی"
    Note "یک پیام آزمایشی به کلاد کد فرستاده می‌شود"

    $env:PYTHONIOENCODING = 'utf-8'
    $smoke = Join-Path $DeployRoot 'smoke_test.py'
    # EAP=Continue for exactly this call. Under EAP=Stop, PowerShell 5.1 wraps a
    # native command's stderr in a terminating NativeCommandError — so the FIRST
    # line of a Python traceback would abort setup.ps1 here, i.e. the
    # not-logged-in machine would get a red English stack trace instead of the
    # Persian login instructions below. Verified 2026-08-05.
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $python $smoke 2>&1 | ForEach-Object { Log "  smoke: $_" }
    $smokeCode = $LASTEXITCODE
    $ErrorActionPreference = $eap
    $smokeOk = $smokeCode -eq 0

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
        Log "  smoke test failed (exit $smokeCode)"
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
