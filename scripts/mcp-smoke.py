#!/usr/bin/env python3
"""Cliente MCP mínimo por stdio, para verificar el binario de verdad.

Existe porque las pruebas de Go usan transportes en memoria: esto ejercita el
camino real (subproceso, JSON-RPC delimitado por saltos de línea, stdout
compartido con nada más) que es exactamente lo que hace Claude Code o Cursor
cuando lanza `saveme mcp`.

Uso:
    python3 scripts/mcp-smoke.py <binario> <acción> [args...]

Acciones:
    tools                 lista las tools y sale
    propose <proj> <tít> <cuerpo>   propone un resumen, imprime el token
    confirm <token>       confirma en la ruta propuesta
    confirm-elicit <token> confirma dejando que el usuario elija (respuesta simulada)
    full <proj> <tít> <cuerpo>      propose + confirm en un solo proceso
"""

import json
import os
import subprocess
import sys


class MCPClient:
    def __init__(self, binary):
        env = dict(os.environ)
        self.proc = subprocess.Popen(
            [binary, "mcp"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            text=True,
            bufsize=1,
        )
        self.next_id = 1

    def send(self, method, params=None):
        msg = {"jsonrpc": "2.0", "id": self.next_id, "method": method}
        if params is not None:
            msg["params"] = params
        self.next_id += 1
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()
        return msg["id"]

    def notify(self, method, params=None):
        msg = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()

    def read_until(self, want_id, timeout_lines=200):
        for _ in range(timeout_lines):
            line = self.proc.stdout.readline()
            if not line:
                raise RuntimeError("el servidor cerró stdout inesperadamente")
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"stdout no es JSON-RPC válido: {line!r} ({exc})")
            if msg.get("id") == want_id:
                return msg
        raise RuntimeError(f"no llegó respuesta para el id {want_id}")

    def initialize(self):
        rid = self.send(
            "initialize",
            {
                "protocolVersion": "2026-07-28",
                "capabilities": {},
                "clientInfo": {"name": "mcp-smoke", "version": "1.0.0"},
            },
        )
        res = self.read_until(rid)
        if "error" in res:
            raise RuntimeError(f"initialize falló: {res['error']}")
        self.notify("notifications/initialized")
        return res["result"]

    def call(self, name, arguments=None):
        rid = self.send("tools/call", {"name": name, "arguments": arguments or {}})
        res = self.read_until(rid)
        if "error" in res:
            raise RuntimeError(f"{name} falló a nivel de protocolo: {res['error']}")

        result = res["result"]
        if result.get("structuredContent") is not None:
            return result["structuredContent"]
        # Sin salida estructurada: concatenar el texto.
        texts = [c.get("text", "") for c in result.get("content", []) if c.get("type") == "text"]
        return {"text": "\n".join(texts), "is_error": result.get("isError", False)}

    def close(self):
        try:
            self.proc.stdin.close()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        err = self.proc.stderr.read()
        return err


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2

    binary, action = sys.argv[1], sys.argv[2]
    client = MCPClient(binary)
    try:
        info = client.initialize()
        print(f"# servidor: {info['serverInfo']['name']} {info['serverInfo']['version']}")
        if info.get("instructions"):
            print(f"# instrucciones: {len(info['instructions'])} caracteres")

        if action == "tools":
            tools = client.send("tools/list", {})
            res = client.read_until(tools)
            for tool in res["result"]["tools"]:
                print(f"  - {tool['name']}: {tool['description'][:70]}...")

        elif action == "propose":
            project, title, body = sys.argv[3], sys.argv[4], sys.argv[5]
            out = client.call(
                "saveme_summary_propose",
                {"project": project, "title": title, "body": body, "agent": "mcp-smoke"},
            )
            print(json.dumps(out, indent=2, ensure_ascii=False))
            print(f"\nTOKEN={out.get('token')}")

        elif action in ("confirm", "confirm-elicit"):
            token = sys.argv[3]
            args = {"token": token, "decision": "accepted"}
            if action == "confirm":
                args["elicit"] = False
            else:
                args["elicit"] = True
            out = client.call("saveme_summary_confirm", args)
            print(json.dumps(out, indent=2, ensure_ascii=False))

        elif action == "full":
            project, title, body = sys.argv[3], sys.argv[4], sys.argv[5]
            prop = client.call(
                "saveme_summary_propose",
                {"project": project, "title": title, "body": body, "agent": "mcp-smoke"},
            )
            print(f"propose -> {prop.get('rel_path')} (categoría {prop.get('category')})")
            conf = client.call(
                "saveme_summary_confirm",
                {"token": prop["token"], "decision": "accepted", "elicit": False},
            )
            print(json.dumps(conf, indent=2, ensure_ascii=False))

        else:
            raise SystemExit(f"acción desconocida: {action}")

    finally:
        err = client.close()
        if err.strip():
            # El log del servidor va a stderr a propósito: comprobamos que no
            # ensucia stdout, que es el canal del protocolo.
            print("# stderr del servidor:")
            for line in err.strip().splitlines()[-5:]:
                print(f"#   {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
