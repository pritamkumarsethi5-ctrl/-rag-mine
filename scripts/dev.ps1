# Development: API on :8000 (auto-reload) and Vite on :5173 in two windows.
$root = Resolve-Path "$PSScriptRoot\.."
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\backend'; .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\frontend'; npm run dev"
Write-Host "Open http://localhost:5173"
