from fastapi import FastAPI

app = FastAPI(title="AI Sprint Manager - AI Service")


@app.get("/health")
def health():
    return {"ok": True, "service": "ai-service"}
