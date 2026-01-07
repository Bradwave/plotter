# Sync Matephis Plot Library to Plotter
# Run this script to update Plotter with the latest changes from the Matephis workspace.

$SourceBase = "..\matephis\assets"
$DestBase = "."

Write-Host "Syncing Matephis Plot Library..." -ForegroundColor Cyan

# 1. Sync JS
$SourceJS = "$SourceBase\js\matephis-plot.js"
$DestJS = "$DestBase\js\matephis-plot.js"
Copy-Item -Path $SourceJS -Destination $DestJS -Force
# Patch JS: Change absolute paths to relative for Plotter
(Get-Content $DestJS) -replace '/assets/img/', 'assets/img/' | Set-Content $DestJS
Write-Host "  [JS]   Synced & Patched matephis-plot.js" -ForegroundColor Green

# 2. CSS (DISABLED - Plotter has independent styling)
# $SourceCSS = "$SourceBase\css\matephis-plot.css"
# $DestCSS = "$DestBase\css\matephis-plot.css"
# Copy-Item -Path $SourceCSS -Destination $DestCSS -Force
# Write-Host "  [CSS]  Synced matephis-plot.css" -ForegroundColor Green

# 3. Sync Fonts
$SourceFonts = "$SourceBase\fonts"
$DestFonts = "$DestBase\assets\fonts"

# Ensure destination exists
if (!(Test-Path $DestFonts)) {
    New-Item -ItemType Directory -Force -Path $DestFonts | Out-Null
}

Copy-Item -Path "$SourceFonts\*" -Destination $DestFonts -Recurse -Force
Write-Host "  [FONT] Synced fonts folder" -ForegroundColor Green

# 4. Sync Images
$SourceImg = "$SourceBase\img"
$DestImg = "$DestBase\assets\img"

# Ensure destination exists
if (!(Test-Path $DestImg)) {
    New-Item -ItemType Directory -Force -Path $DestImg | Out-Null
}

Copy-Item -Path "$SourceImg\*" -Destination $DestImg -Recurse -Force
Write-Host "  [IMG]  Synced img folder" -ForegroundColor Green

Write-Host "Sync Complete!" -ForegroundColor Cyan
