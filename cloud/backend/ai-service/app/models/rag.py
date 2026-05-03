from pydantic import BaseModel, Field
from typing import Optional
from uuid import UUID


NIL_UUID = str(UUID(int=0))


class IngestGitnexusRequest(BaseModel):
    repo: str = Field(..., description="e.g. deekshithgowda85/Agile_Scrum_Master")
    files: list[dict] = Field(..., description="[{path: str, content: str}]")
    commit_sha: str
    project_id: str


class RagChatRequest(BaseModel):
    message: str
    project_id: str = NIL_UUID
    source_types: Optional[list[str]] = None
    stream: bool = True


class QueryChunksRequest(BaseModel):
    query: str
    project_id: str = NIL_UUID
    top_k: int = 5
