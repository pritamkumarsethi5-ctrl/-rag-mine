# Starts RAG-Mine (API + built UI) on http://127.0.0.1:8000  -- SIMULATION MODE
Set-Location "$PSScriptRoot\..\backend"
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
