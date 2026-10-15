<#
  Open the Persian Claude window for a Linux machine, over SSH (wiki/linux-ssh.md).

    connect.bat user@server                  open (or reopen) that server's window
    connect.bat user@server -RemotePort 8800 the server was installed with --port 8800
    connect.bat user@server -Stop            close that server's tunnel
    connect.bat -List                        the servers this PC knows, and their ports

  The server side is install-linux.sh. Each server gets its OWN local port,
  remembered in %APPDATA%\persian-claude\tunnels.json, so several servers can be
  open at once in separate windows, and the same server always comes back on the
  same port (its zoom, layout and sign-in cookie are kept per port).

  The tunnel is plain OpenSSH (`ssh -N -L`), in the background. With key-based
  login it is invisible; with a password it opens in its own console, which has
  to stay open.
#>
param(
    [Parameter(Position = 0)] [string] $Target,
    [int] $RemotePort = 8765,
    [int] $LocalPort = 0,
    [switch] $Stop,
    [switch] $List
)
$ErrorActionPreference = 'Stop'

$stateDir = Join-Path $env:APPDATA 'persian-claude'
$stateFile = Join-Path $stateDir 'tunnels.json'
$tunnels = @{}
if (Test-Path $stateFile) {
    (Get-Content $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $tunnels[$_.Name] = [int]$_.Value }
}

function Save-Tunnels {
    New-Item -ItemType Directory -Force $stateDir | Out-Null
    ($tunnels | ConvertTo-Json) | Out-File -FilePath $stateFile -Encoding utf8
}

function Test-Port([int] $port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $wait = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        return ($wait.AsyncWaitHandle.WaitOne(300) -and $client.Connected)
    } catch { return $false } finally { $client.Close() }
}

function Get-TunnelProcess([int] $port) {
    Get-CimInstance Win32_Process -Filter "Name = 'ssh.exe'" |
        Where-Object { $_.CommandLine -match ("-L\s+" + $port + ":127\.0\.0\.1:") }
}

if ($List) {
    if (-not $tunnels.Count) { Write-Host 'No servers yet.'; exit 0 }
    foreach ($name in $tunnels.Keys) {
        $port = $tunnels[$name]
        $state = if (Get-TunnelProcess $port) { 'open' } else { 'closed' }
        Write-Host ("{0,-40} 127.0.0.1:{1}  {2}" -f $name, $port, $state)
    }
    exit 0
}
if (-not $Target) { Write-Host 'Usage: connect.bat user@server [-RemotePort 8765] [-Stop] | -List'; exit 2 }

# One local port per server, kept. A new server takes the first free port from 8701.
if (-not $LocalPort) {
    if ($tunnels.ContainsKey($Target)) {
        $LocalPort = $tunnels[$Target]
    } else {
        $taken = @($tunnels.Values)
        $LocalPort = 8701
        while ($taken -contains $LocalPort -or (Test-Port $LocalPort)) { $LocalPort++ }
    }
}
$tunnels[$Target] = $LocalPort
Save-Tunnels

if ($Stop) {
    $procs = @(Get-TunnelProcess $LocalPort)
    $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }
    Write-Host ("Closed {0} tunnel(s) to {1}. Claude keeps running on the server." -f $procs.Count, $Target)
    exit 0
}

$ssh = (Get-Command ssh.exe -ErrorAction SilentlyContinue).Source
if (-not $ssh) {
    Write-Host 'OpenSSH client not found. Settings > System > Optional features > OpenSSH Client.'
    exit 1
}

# Key-based login lets everything run hidden; a password needs a console.
& $ssh -o BatchMode=yes -o ConnectTimeout=10 $Target true 2>$null
$batch = ($LASTEXITCODE -eq 0)
if (-not $batch) { Write-Host "No key-based login to $Target - you will be asked for the password." }

# The token the server keeps (server.py persistent_token). No double quotes in
# the remote command: Windows PowerShell 5.1 strips them on the way to a native exe.
$token = (& $ssh $Target 'cat ${XDG_CONFIG_HOME:-$HOME/.config}/persian-claude/token' 2>$null | Select-Object -First 1)
if (-not $token) {
    Write-Host "No token on $Target. Install the server there first: ./install-linux.sh"
    exit 1
}
$token = $token.Trim()

if (-not (Test-Port $LocalPort)) {
    $forward = "{0}:127.0.0.1:{1}" -f $LocalPort, $RemotePort
    $sshArgs = @('-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30',
                 '-o', 'ServerAliveCountMax=3', '-L', $forward, $Target)
    $style = if ($batch) { 'Hidden' } else { 'Normal' }
    Start-Process -FilePath $ssh -ArgumentList $sshArgs -WindowStyle $style | Out-Null
    $deadline = (Get-Date).AddSeconds($(if ($batch) { 20 } else { 120 }))
    while (-not (Test-Port $LocalPort)) {
        if ((Get-Date) -gt $deadline) { Write-Host 'The tunnel did not come up.'; exit 1 }
        Start-Sleep -Milliseconds 300
    }
}

$url = "http://127.0.0.1:$LocalPort/?t=$token"
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
          "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) { Start-Process -FilePath $edge -ArgumentList "--app=$url" | Out-Null }
else { Start-Process $url | Out-Null }
Write-Host "$Target -> 127.0.0.1:$LocalPort"
