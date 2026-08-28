"""`/mcp-keys` — the bearer keys the owner hands to MCP clients, and takes back.

Guarded like every other route: minting a token that opens `/mcp` is as privileged as
minting a runner's. **The token appears exactly once**, in the answer to the request that
mints it. Nothing stores it, so nothing can show it again; a lost key is a revoke and a
new one — which is also why revoking is a plain delete and not a disable.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response, status

from backend.api.deps import SessionDep, not_found
from backend.api.schemas import McpKeyCreate, McpKeyCreated, McpKeyResponse
from backend.services import mcp_keys as mcp_keys_service

router = APIRouter(prefix="/mcp-keys", tags=["mcp-keys"])


@router.get("", response_model=list[McpKeyResponse], summary="Every MCP bearer key")
def list_keys(session: SessionDep) -> list[dict[str, Any]]:
    return [mcp_keys_service.key_payload(key) for key in mcp_keys_service.list_keys(session)]


@router.post(
    "",
    response_model=McpKeyCreated,
    status_code=status.HTTP_201_CREATED,
    summary="Mint an MCP bearer key",
)
def create_key(session: SessionDep, body: McpKeyCreate) -> McpKeyCreated:
    """Mint a key. Only a SHA-256 of it is stored, so this response is its only reading."""
    key, token = mcp_keys_service.create_key(session, body.name)
    return McpKeyCreated(
        key=McpKeyResponse.model_validate(mcp_keys_service.key_payload(key)), token=token
    )


@router.delete(
    "/{key_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Revoke an MCP bearer key"
)
def delete_key(session: SessionDep, key_id: int) -> Response:
    if not mcp_keys_service.delete_key(session, key_id):
        raise not_found("unknown_mcp_key", f"no MCP key with id {key_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
