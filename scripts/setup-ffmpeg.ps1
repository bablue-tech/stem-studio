$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$zip = Join-Path $root "tools\ffmpeg.zip"
$tmp = Join-Path $root "tools\_tmp"
$dest = Join-Path $root "tools\ffmpeg"
$url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"

if (Test-Path (Join-Path $dest "ffmpeg.exe")) {
    Write-Output "ffmpeg already present at $dest"
    exit 0
}

New-Item -ItemType Directory -Force -Path (Join-Path $root "tools") | Out-Null
Write-Output "downloading ffmpeg essentials (~90MB)..."
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
Write-Output "extracting..."
Expand-Archive -Path $zip -DestinationPath $tmp -Force
$bin = Get-ChildItem $tmp -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1 -ExpandProperty DirectoryName
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item "$bin\ffmpeg.exe", "$bin\ffprobe.exe" $dest
Remove-Item $tmp -Recurse -Force
Remove-Item $zip
& (Join-Path $dest "ffmpeg.exe") -version | Select-Object -First 1
