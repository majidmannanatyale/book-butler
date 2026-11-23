"""Load the library MCP server object so agents can talk to it in-process.

fastmcp's Client(server_object) uses an in-memory transport: real MCP protocol
(list_tools / call_tool), no subprocess, which keeps Windows + uvicorn simple.
"""

from __future__ import annotations

import importlib.util

from config import ROOT

_spec = importlib.util.spec_from_file_location("library_mcp_server", ROOT / "mcp_server" / "server.py")
_mod = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
_spec.loader.exec_module(_mod)  # type: ignore[union-attr]

MCP_SERVER = _mod.mcp
