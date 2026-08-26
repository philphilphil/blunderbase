"""All business logic.

Every function takes an explicit `Session` and never imports FastAPI or the MCP SDK:
`backend.api` and `backend.mcp` are thin wrappers over this package, so the web UI and
the coach can never disagree about what a "blunder" or a stat means.
"""
