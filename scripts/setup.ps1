# RAG-Mine one-time setup (Windows PowerShell). Run from the project root.
$ErrorActionPreference = "Stop"
Write-Host "== Backend =="
Set-Location "$PSScriptRoot\..\backend"
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
Write-Host "== Frontend =="
Set-Location "$PSScriptRoot\..\frontend"
npm install
npm run check:i18n
npm run build
Write-Host "Setup complete. Run scripts\run.ps1"
