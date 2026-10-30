// Kiki (easyagent) as a magpie agent.
//
// Kiki keeps its providers and models in ~/.kiki/config.toml, and magpie's
// agent plugins can only edit JSON, YAML or env files (TOML isn't one of
// their formats yet). So this side writes a small JSON handoff instead:
// the model magpie's Agents page picked, the gateway's address and Kiki's
// own key. The Magpie Bridge Kiki plugin, shipped in this same folder,
// reads it when a Kiki session starts and keeps ~/.kiki/config.toml in
// step. Install that plugin in Kiki once; see README.md.
//
// Kiki also takes the Library here: instructions in ~/.kiki/AGENTS.md,
// MCP servers in ~/.kiki/mcp.json (Kimi's shape) and skills in
// ~/.kiki/skills.

export const agent = {
  id: "kiki",
  name: "Kiki",
  // a small K mark, so the row isn't a generic square
  icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9IiMxMTExMTEiLz48cGF0aCBkPSJNMTggMTNoOHYxNi41TDQxIDEzaDEwLjVMMzQuNSAzMi41IDUyIDUxSDQxTDI2IDM1LjJWNTFoLTh6IiBmaWxsPSIjZmZmZmZmIi8+PGNpcmNsZSBjeD0iNDgiIGN5PSIxNiIgcj0iNCIgZmlsbD0iIzdjNWNmZiIvPjwvc3ZnPg==",
  // Kiki installed: its home folder is there (also checked by magpie)
  dir: "~/.kiki",
  // where magpie writes what the Kiki-side plugin reads
  config: "~/.kiki/magpie.json",
  format: "json",
  model: "model",
  // Kiki identifies itself as kiki-cli; named here so Usage can tell it
  ua: ["kiki-cli"],
  notice: "New Kiki sessions use this model. Keep the bundled Magpie Bridge plugin installed and enabled in Kiki; it applies the choice to ~/.kiki/config.toml at session start.",
  library: {
    instructions: "~/.kiki/AGENTS.md",
    mcp: "~/.kiki/mcp.json",
    mcpFormat: "kimi",
    skills: "~/.kiki/skills"
  }
}

// connect runs in magpie's own process (moejs): no files, no network, no
// timers. It returns the keys to write beside the model. The model itself
// is written by magpie at `model`, so it isn't returned here.
export function connect(input) {
  const gateway = input.gateway
  const model = input.model || {}
  return {
    "gateway.url": gateway.url,
    "gateway.v1": gateway.v1,
    "gateway.key": gateway.key,
    "name": model.name || model.id || "",
    "context": model.context || 0,
    "output": model.output || 0,
    "images": model.images === true,
    "efforts": model.efforts || []
  }
}
