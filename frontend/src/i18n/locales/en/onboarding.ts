/**
 * Strings for `onboarding`. Same shape as `es/onboarding.ts`, which is the
 * source of truth for the keys.
 *
 * The base key of each plural (`…selected`, `…failed`, `…manualNote`) exists
 * alongside `_one` / `_other` because `t()` is called without the suffix.
 */
export const onboarding = {
  // Notas de cada cliente MCP. Misma forma que `es/onboarding.ts`.
  providerNote: {
    'codex': 'In TOML the section is [mcp_servers.saveme] and the environment goes in a subsection [mcp_servers.saveme.env].',
    "claude-code": "Claude Code has three scopes: local (this project only), project (shared through git), and user (all your projects). To make it work in any project, the last one is the one you want. It's configured with its own command, not by editing ~/.claude.json, which is its state file.",
    "gemini-cli": "The path and the format come from Gemini CLI's convention, not from documentation I've been able to confirm. If it doesn't find it, check its docs.",
    "kiro": "The path and the format come from Kiro's convention, not from documentation I've been able to confirm. If it doesn't find it, check its docs.",
    'vscode-copilot': 'VS Code uses `servers` instead of `mcpServers` and requires `type: "stdio"`. This block is for your user configuration; you can also put it in .vscode/mcp.json inside a specific project.',
    "opencode": "OpenCode merges configuration files instead of replacing them, so this block lives alongside the MCP servers you already have. It requires `type: \"local\"` and the arguments inside `command`. If the file is JSONC with comments it won't be rewritten: you get the block to paste.",
    'generic': 'The `mcpServers` block is the de facto format. If your client uses another one, check its documentation.',
    "windsurf": "The path and the format come from Windsurf's convention, not from documentation I've been able to confirm. If it doesn't find it, check its docs.",
    "qwen": "The path and the format come from Qwen Code's convention, not from documentation I've been able to confirm. If it doesn't find it, check its docs.",
    "kilocode": "Kilo Code is a VS Code extension and keeps its MCP servers in the extension's internal store, which changes between versions. You get the standard block to paste wherever it belongs.",
  },
  wizard: {
    title: 'set up the mcp server',
    description:
      'Wizard to install the SaveMe MCP server and register it with your AI clients.',
    emptySelection: 'select at least one client, or skip this step',
    coreUnavailable: "the core isn't responding; without it there's nothing I can configure",
    saveFailed: "Couldn't save that you've seen the wizard",
  },
  nav: {
    step: 'step {current}/{total} · {title}',
    intro: 'what will happen',
    providers: 'choose your clients',
    apply: 'apply',
    done: 'done',
  },
  intro: {
    lead: {
      before: 'The MCP server is ',
      emphasis: 'the same binary as the app',
      after:
        ', so it works with SaveMe closed: it talks straight to the database and the files.',
    },
    binary: {
      title: 'There is nothing to download',
      body: 'The binary is self-contained (pure Go, no CGO). You do not need Go, Node, or anything else installed: it ships inside the app.',
    },
    ownFolder: {
      title: 'It is copied to a folder of its own',
      body: 'That way your agents’ configs do not point inside the app: if you move or delete SaveMe, the MCP server stays where it was.',
    },
    subcommand: {
      title: 'It registers as `saveme mcp`',
      body: 'Both subcommands —`serve` and `mcp`— resolve the same workspace, and that is the only thing that has to match.',
    },
    alreadyAt: 'the binary is already at',
    willBeCreatedAt: 'will be created at',
    installing: 'installing…',
    verify: 'verify the installation',
    install: 'install the MCP server',
    alreadyInstalled: 'It was already installed: running it again breaks nothing.',
    nothingDownloaded:
      'Nothing is downloaded from the internet: it copies the binary you already have.',
    readError: "couldn't read the mcp server status",
    installError: "couldn't install the binary",
    onPath: 'The binary also answers to `saveme`, so configs can use the bare name.',
    notOnPath:
      'The binary is not on your PATH: clients will use the absolute path above. It works the same.',
  },
  providers: {
    lead: {
      before:
        'Pick the clients you want your agent to be able to save summaries through. They get the ',
      after:
        ' entry added without deleting anything they already have: if a file has to change, a backup is kept.',
    },
    configure: 'configure {name}',
    badge: {
      installed: 'installed',
      notDetected: 'not detected',
      configured: 'already configured',
      unverified: 'format unconfirmed',
      manual: 'you paste it',
    },
    cliOnly: 'configured with a command, it has no file',
    noPath: 'no fixed path: we give you the block to paste wherever your client expects it',
    generic:
      'This one is not automated: we give you the block to paste wherever your client expects it.',
    selected: '{count} selected',
    selected_one: '{count} selected',
    selected_other: '{count} selected',
    selectedNone: 'none selected',
    selectDetected: 'select the detected ones',
    detected: {
      title: 'detected on your machine',
      hint: 'the ones I found here',
    },
    undetected: {
      title: 'not detected',
      hint: 'you can still select them if you keep them elsewhere',
    },
  },
  apply: {
    lead: 'The binary is installed before anything is written: a config pointing at one that does not exist fails silently.',
    configuring: 'Configuring {count} clients.',
    configuring_one: 'Configuring one client.',
    configuring_other: 'Configuring {count} clients.',
    binaryLabel: 'binary:',
    writeError: "couldn't configure the clients",
    action: {
      created: 'created',
      merged: 'added',
      updated: 'updated',
      alreadyConfigured: 'already there',
      manual: 'by hand',
    },
    writing: 'writing…',
    notAttempted: 'not written: the call failed',
    backupLabel: 'backup:',
    command: 'run this command',
    snippet: 'block for {name}',
    pasteIn: 'paste into',
    snippetLoading: 'preparing the block…',
    snippetError: "couldn't generate the block",
    envFixed: 'Sets {vars} so the MCP resolves the same workspace as the app.',
    allGood: 'No errors. Nothing else to do here.',
    failed: '{count} with errors',
    failed_one: '{count} with an error',
    failed_other: '{count} with errors',
    retryFailed: 'retry the ones that failed',
    manualNote:
      'One client is left in manual mode: copy the command or the block and paste it yourself. It is not a failure.',
    manualNote_one:
      'One client is left in manual mode: copy the command or the block and paste it yourself. It is not a failure.',
    manualNote_other:
      '{count} clients are left in manual mode: copy the command or the block and paste it yourself. It is not a failure.',
  },
  done: {
    lead: 'That is it. The MCP server and the configs live outside the app, so they keep working with SaveMe closed.',
    restart: {
      title: 'Restart the client you configured',
      body: 'Clients read their MCP config on startup. Until you restart it, the SaveMe tools will not show up.',
    },
    guide: {
      title: 'Teach the agent the workflow',
      body: 'One line in your project’s instructions file (or your agent’s global one). The text explains the two-phase workflow and the category taxonomy.',
      label: 'in the root of your project',
    },
    check: {
      title: 'check that it worked',
      before: 'Open your agent and ask it ',
      emphasis: '“save a summary of what we just did”',
      after:
        '. The proposal shows up in the inbox so you decide where it gets written: nothing is written without your confirmation.',
    },
    reopen:
      'You can come back to this wizard any time from the command palette (Cmd+K) → “set up the MCP in other agents”.',
  },
  copy: {
    success: 'Copied to clipboard',
    error: "Couldn't use the clipboard",
    errorHint: 'I left the text selected: copy it with Cmd/Ctrl+C.',
  },
} as const
