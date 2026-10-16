# Isolated Rust build from a fresh checkout. Never touches production or local work.
[CmdletBinding()]
param(
    [switch]$InstallTask,
    [string]$At = '03:30'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($InstallTask) {
    $time = [datetime]::ParseExact(
        $At, 'HH:mm', [System.Globalization.CultureInfo]::InvariantCulture
    )
    $args = '-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "' + $PSCommandPath + '"'
    $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $args
    $trigger = New-ScheduledTaskTrigger -Daily -At $time
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 45)
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName 'Afterparty Rust Nightly' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    Write-Host "Registered Afterparty Rust Nightly for $At local time (while signed in)."
    exit 0
}

foreach ($command in @('git', 'cargo', 'rustc')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Missing command: $command. Install Git and rustup first."
    }
}

$base = Join-Path $env:LOCALAPPDATA 'Afterparty\RustNightly'
$run = Join-Path $base (Get-Date -Format 'yyyyMMdd-HHmmss')
New-Item -ItemType Directory -Path $run -Force | Out-Null
$temp = Join-Path $env:TEMP ('afterparty-rust-' + [guid]::NewGuid().ToString('N'))
Start-Transcript -Path (Join-Path $run 'build.log') -Force | Out-Null

try {
    & git clone --quiet --depth 1 --branch main 'https://github.com/lukasvri/Afterparty-MusicBot.git' $temp
    if ($LASTEXITCODE -ne 0) { throw 'Could not clone current main.' }
    $sha = (& git -C $temp rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Could not read source revision.' }
    $manifest = Join-Path $temp 'experiments\rust-audio\Cargo.toml'
    if (-not (Test-Path $manifest)) {
        throw 'Rust experiment not found on main. Merge the reviewed PR first.'
    }

    & cargo fmt --manifest-path $manifest --all -- --check
    if ($LASTEXITCODE -ne 0) { throw 'Formatting failed.' }
    & cargo clippy --manifest-path $manifest --all-targets --locked -- -D warnings
    if ($LASTEXITCODE -ne 0) { throw 'Clippy failed.' }
    & cargo test --manifest-path $manifest --locked
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
    & cargo build --manifest-path $manifest --release --locked
    if ($LASTEXITCODE -ne 0) { throw 'Release build failed.' }

    $binary = Join-Path $temp 'experiments\rust-audio\target\release\afterparty-rust-audio.exe'
    if (-not (Test-Path $binary)) { throw 'Release executable is missing.' }
    & $binary --bench | Tee-Object -FilePath (Join-Path $run 'benchmark.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Offline benchmark failed.' }
    Copy-Item $binary (Join-Path $run 'afterparty-rust-audio.exe')
    Set-Content -Path (Join-Path $run 'commit.txt') -Value $sha
    Write-Host "Completed offline Rust build for $sha. Results: $run"
} finally {
    if (Test-Path $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
    Stop-Transcript | Out-Null
}
