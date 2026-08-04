#Requires -Version 5.1
# Build + publica a release do exe (Tauri + auto-update) no Windows.
#
# IMPORTANTE: o build do Tauri DEVE rodar a partir de um caminho SEM acentos,
# porque as ferramentas MinGW (dlltool/ld/llvm-rc) não abrem caminhos com
# caracteres não-ASCII (ex: "Área de Trabalho"). Este script copia o projeto
# para um diretório temporário sem acentos, monta o ambiente e roda o
# `scripts/release-tauri.mjs` lá.
#
# Uso:
#   .\scripts\release-windows.ps1                 # bump patch + build + release
#   .\scripts\release-windows.ps1 1.0.21          # versão fixa + build + release
#   .\scripts\release-windows.ps1 -BuildOnly      # só gera o exe, sem publicar
#
# Requisitos:
#   - LLVM-MinGW (MartinStorsjo.LLVM-MinGW.UCRT) e WinLibs
#     (BrechtSanders.WinLibs.POSIX.UCRT) instalados via winget
#   - GitHub CLI (gh) instalado em "C:\Program Files\GitHub CLI" e autenticado
#   - Chaves de assinatura em client/src-tauri/.tauri/
#
# Depois de publicar, commite o bump de versão no repo:
#   npm run release -- "chore: build X.Y.Z"

param(
  [string]$Version = "",
  [switch]$BuildOnly
)

$ErrorActionPreference = "Stop"

$repoRoot  = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$workRoot  = Join-Path $env:TEMP "voip-release-work"
$toolBin   = Join-Path $workRoot "toolbin"

function Find-MinGw($pattern) {
  $dir = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
  $pkg = Get-ChildItem $dir -Directory -Filter $pattern -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $pkg) { return $null }
  return $pkg.FullName
}

$llvmPkg  = Find-MinGw "MartinStorsjo.LLVM-MinGW*"
$winPkg   = Find-MinGw "BrechtSanders.WinLibs*"
if (-not $llvmPkg -or -not $winPkg) {
  Write-Error "Instale LLVM-MinGW (MartinStorsjo.LLVM-MinGW.UCRT) e WinLibs (BrechtSanders.WinLibs.POSIX.UCRT) via winget."
}

$llvmBin  = Get-ChildItem $llvmPkg -Recurse -Filter "x86_64-w64-mingw32-gcc.exe" -ErrorAction SilentlyContinue |
  Select-Object -First 1 | Select-Object -ExpandProperty DirectoryName
$libgcc   = Get-ChildItem $winPkg -Recurse -Filter "libgcc_eh.a" -ErrorAction SilentlyContinue |
  Select-Object -First 1 | Select-Object -ExpandProperty DirectoryName
if (-not $llvmBin -or -not $libgcc) {
  Write-Error "Não encontrei o compilador LLVM-MinGW ou as libs da WinLibs. Confira os pacotes instalados."
}

$winBin   = Join-Path (Split-Path (Split-Path (Split-Path (Split-Path $libgcc)))) "bin"
$gccExe   = Join-Path $winBin "x86_64-w64-mingw32-gcc.exe"

# 1) Cópia do projeto para caminho sem acentos (mantém target/ já compilado).
if (-not (Test-Path $workRoot)) {
  New-Item -ItemType Directory -Path $workRoot -Force | Out-Null
}
robocopy $repoRoot $workRoot /E /XD .git node_modules target /XF test2.exe /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -gt 7) { Write-Error "robocopy falhou (código $LASTEXITCODE)" }

# 2) Junctions do node_modules para reaproveitar as dependências já instaladas.
foreach ($rel in @("", "client")) {
  $link = Join-Path $workRoot $rel
  if ($rel) { $link = Join-Path $workRoot "$rel\node_modules" }
  else { $link = Join-Path $workRoot "node_modules" }
  if (-not (Test-Path $link)) {
    New-Item -ItemType Junction -Path $link -Target (Join-Path $repoRoot "$rel\node_modules") | Out-Null
  }
}

# 3) Wrapper do windres: remove o prefixo "\\?\" (caminho estendido) que o
#    tauri-build coloca no resource.rc e que o llvm-rc não consegue abrir.
New-Item -ItemType Directory -Path $toolBin -Force | Out-Null
$wrapperC = Join-Path $PSScriptRoot "windres-wrapper.c"
$wrapperExe = Join-Path $toolBin "windres.exe"
if (-not (Test-Path $wrapperExe)) {
  & $gccExe $wrapperC -o $wrapperExe
  if ($LASTEXITCODE -ne 0) { Write-Error "Falha ao compilar o wrapper do windres." }
}

# 4) Ambiente: windres wrapper + LLVM-MinGW (linker lld) + WinLibs (libgcc) + gh.
$env:PATH = "$toolBin;$llvmBin;$winBin;C:\Program Files\GitHub CLI;$env:PATH"
$env:RUSTFLAGS = "-C linker=$llvmBin\x86_64-w64-mingw32-gcc.exe -C link-arg=-L$libgcc"

# 5) Roda o script de release na cópia.
$mjsArgs = @()
if ($Version) { $mjsArgs += $Version }
if ($BuildOnly) { $mjsArgs += "--build-only" }
Push-Location $workRoot
try {
  node scripts/release-tauri.mjs @mjsArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

# 6) Copia o instalador gerado para installers/ no repo (como nas versões antigas).
$nsis = Join-Path $workRoot "client\src-tauri\target\release\bundle\nsis"
$installer = Get-ChildItem $nsis -Filter "*_x64-setup.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($installer) {
  Copy-Item $installer.FullName (Join-Path $repoRoot "installers") -Force
  Write-Host "Instalador copiado para installers/ (nome do release gerado pelo script)."
}
