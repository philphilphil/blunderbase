# Build the web UI, frozen backend, and native Windows installer.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

$desktopDir = Split-Path -Parent $PSScriptRoot
$repoDir = Split-Path -Parent $desktopDir
$tauriDir = Join-Path $desktopDir "src-tauri"
$pyinstallerDir = Join-Path $desktopDir ".pyinstaller"

Push-Location (Join-Path $repoDir "web")
try {
    pnpm build
}
finally {
    Pop-Location
}

if (Test-Path $pyinstallerDir) {
    Remove-Item -Recurse -Force $pyinstallerDir
}
$buildDirectories = @(
    (Join-Path $pyinstallerDir "dist")
    (Join-Path $pyinstallerDir "work")
    (Join-Path $pyinstallerDir "spec")
)
New-Item -ItemType Directory -Force -Path $buildDirectories | Out-Null

$env:UV_CACHE_DIR = Join-Path $repoDir ".uv-desktop-cache"
$migrationData = "$(Join-Path $repoDir 'backend/migrations');backend/migrations"
$webData = "$(Join-Path $repoDir 'web/dist');web/dist"

Push-Location $repoDir
try {
    uv run --with pyinstaller pyinstaller `
        --noconfirm `
        --clean `
        --onedir `
        --noconsole `
        --name blunderbase-desktop `
        --paths $repoDir `
        --collect-submodules backend `
        --add-data $migrationData `
        --add-data $webData `
        --distpath (Join-Path $pyinstallerDir "dist") `
        --workpath (Join-Path $pyinstallerDir "work") `
        --specpath (Join-Path $pyinstallerDir "spec") `
        (Join-Path $desktopDir "backend_entry.py")
}
finally {
    Pop-Location
}

Push-Location $desktopDir
try {
    pnpm exec tauri icon (Join-Path $repoDir "docs/design/brand/logo.png") `
        --output (Join-Path $tauriDir "icons")
    pnpm exec tauri build --bundles nsis --ci
}
finally {
    Pop-Location
}

Write-Host "Windows installer: $tauriDir\target\release\bundle\nsis"
