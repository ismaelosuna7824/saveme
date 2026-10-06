import type { Dict } from './es'

const en: Dict = {
  meta: {
    title: 'SaveMe — the technical journal of your projects, in markdown',
    description:
      'Save what was done and why after every feature, fix or decision. Your AI agent writes it over MCP, always asks you where to save it, and it ends up as a .md file you own. Open source for macOS, Windows and Linux.',
  },
  nav: {
    why: 'Why',
    features: 'Benefits',
    screenshots: 'Screenshots',
    download: 'Download',
    install: 'Install',
    github: 'GitHub',
    language: 'Language',
  },
  hero: {
    eyebrow: 'open source · local-first · MCP',
    titleHtml: 'Six months from now you will know <em>what was done and why</em>.',
    lead:
      'SaveMe is a technical project journal in markdown. When you finish a change you ask your AI agent to save a summary; SaveMe asks you where and leaves it as a .md file on your disk.',
    downloadFor: 'Download for {os}',
    allDownloads: 'All downloads',
    viewOnGithub: 'View on GitHub',
    latest: 'Latest version',
    loading: 'checking…',
    seeOnGithub: 'see on GitHub',
    free: 'Free and open source. No account, no cloud.',
  },
  why: {
    kicker: 'what it is for',
    title: 'The why gets lost. SaveMe keeps it.',
    lead:
      'Code tells you what it does. Git history tells you what changed. Neither tells you why it was decided that way, what was ruled out or what was left pending, and the chat with the agent where it was discussed dies with the session.',
    cards: [
      {
        title: 'Six months later',
        body: 'You come back to a project and can’t remember why the watcher has a delay or why SQLite was chosen. The summary is there, with context, alternatives and risks.',
      },
      {
        title: 'Beyond git log',
        body: 'Human sentences per feature, fix and decision, grouped by project and category. You get release notes someone can actually read.',
      },
      {
        title: 'Your agent writes it',
        body: 'You don’t draft anything: the agent you already use knows the change and writes the summary. You only decide where it goes.',
      },
    ],
  },
  how: {
    kicker: 'how it works',
    title: 'Three steps, and you decide the last one',
    flow: { agent: 'agent', propose: 'propose', ask: 'ask', you: 'you', confirm: 'confirm' },
    steps: [
      {
        title: 'Ask your agent',
        bodyHtml: 'When you finish a change: <code>“save a summary in SaveMe”</code>. The agent talks to SaveMe over MCP.',
      },
      {
        title: 'SaveMe asks you where',
        bodyHtml:
          'The agent proposes a project and a category. Nothing is written until you accept or pick another place, in the chat or in the app’s <strong>Inbox</strong>.',
      },
      {
        title: 'A .md file you own',
        bodyHtml:
          'The summary lands in <code>~/Documents/SaveMe/&lt;project&gt;/&lt;category&gt;/</code>. Read it with any editor and version it with git.',
      },
    ],
  },
  features: {
    kicker: 'benefits',
    title: 'What you get',
    items: [
      {
        title: 'Your files, your disk',
        body: 'Every summary is a plain markdown file. The file is the source of truth; the app is a comfortable way to read it. No account, no cloud, no lock-in.',
      },
      {
        title: 'Never writes without asking',
        body: 'Proposing doesn’t touch the disk. Only a confirmation with a single-use token writes, and it records whether a person or the agent approved it.',
      },
      {
        title: 'Works with the app closed',
        body: 'The MCP server is the same binary and talks straight to the files. When you open the app, the new summaries are already there.',
      },
      {
        title: '26 AI clients',
        body: 'Claude Code, Cursor, Codex, Copilot, Gemini CLI, OpenCode and more. The first-launch wizard detects them and configures them for you, with a backup.',
      },
      {
        title: 'Where did we leave off?',
        body: 'Each project’s pulse: the latest activity, the files touched, what is pending and a year-long activity map.',
      },
      {
        title: 'Release notes for free',
        body: 'Pick a date range and get a markdown changelog grouped by category. From the terminal too: saveme changelog.',
      },
      {
        title: 'A real editor',
        body: 'Obsidian-style live preview, Mermaid diagrams, tickable checkboxes, optional vim mode and full-text search.',
      },
      {
        title: 'Share and export',
        body: 'Save a summary as clean markdown, share it on Slack, X or LinkedIn, or export a whole project as a single document.',
      },
      {
        title: 'Make it yours',
        body: '17 themes with checked contrast, background images, pixel project icons, English and Spanish. It updates itself with signed packages.',
      },
    ],
  },
  screenshots: {
    kicker: 'screenshots',
    title: 'What it looks like',
    items: {
      editor: {
        title: 'The editor',
        caption: 'Live preview with Mermaid diagrams, tasks and code. Syntax only shows on the cursor’s line.',
      },
      inbox: {
        title: 'Inbox',
        caption: 'The agent’s proposals wait for your decision: accept the destination or pick another.',
      },
      pulse: {
        title: 'Project pulse',
        caption: 'Where you left off, what is pending and a year of work at a glance.',
      },
      onboarding: {
        title: 'First launch',
        caption: 'The wizard detects your agents and configures the MCP server in the ones you pick.',
      },
      palette: {
        title: 'Command palette',
        caption: 'Cmd+K to jump to any project, summary or action.',
      },
      settings: {
        title: 'Themes',
        caption: '17 complete palettes, from phosphor to paper.',
      },
      background: {
        title: 'Background image',
        caption: 'Your photo behind the whole window. Bars and cards turn into frosted glass so the text stays readable.',
      },
    },
  },
  clients: {
    kicker: 'works with',
    title: 'Works with the agent you already use',
    lead: 'SaveMe exposes an MCP server. The app and the CLI know how to configure these clients, and any other one through the custom client mode.',
  },
  download: {
    kicker: 'download',
    title: 'Supported platforms',
    lead: 'Links always point to the latest version published on GitHub. After that, the app updates itself.',
    version: 'Version',
    allReleases: 'See all releases',
    recommended: 'recommended',
    howToInstall: 'How to install on {os}',
    platforms: {
      macos: {
        name: 'macOS',
        requirements: 'macOS 10.15 or later · universal (Apple Silicon and Intel)',
      },
      windows: {
        name: 'Windows',
        requirements: 'Windows 10 and 11 · x64',
      },
      linux: {
        name: 'Linux',
        requirements: 'x64 · .deb for Debian/Ubuntu, AppImage for the rest',
      },
    },
    assets: {
      dmg: '.dmg installer',
      exe: '.exe installer',
      msi: '.msi package',
      deb: '.deb package',
      appimage: 'AppImage',
    },
  },
  install: {
    kicker: 'install',
    title: 'How to install',
    lead:
      'SaveMe is open source and isn’t signed with a paid Apple or Microsoft certificate. That is why your system warns you the first time and asks you to confirm. It’s expected: here is every step.',
    tabs: { macos: 'macOS', windows: 'Windows', linux: 'Linux' },
    permissionsTitle: 'Permissions it may ask for',
    troubleshootingTitle: 'If something goes wrong',
    macos: {
      steps: [
        {
          title: 'Download the .dmg',
          bodyHtml: 'One for every Mac: Apple Silicon and Intel.',
        },
        {
          title: 'Drag it to Applications',
          bodyHtml: 'Open the <code>.dmg</code> and drag <strong>SaveMe</strong> into the <strong>Applications</strong> folder.',
        },
        {
          title: 'Open it and allow it in Privacy & Security',
          bodyHtml:
            'The first time, macOS says it can’t verify the developer and won’t open it. Close that dialog (don’t move it to the Trash), go to <strong>System Settings → Privacy &amp; Security</strong>, scroll down to the Security section, click <strong>Open Anyway</strong> next to the message about SaveMe being blocked and confirm with your password. You only do this once.',
        },
        {
          title: 'Follow the wizard',
          bodyHtml:
            'It explains what it is going to do, shows which agents you have installed and configures the MCP server in the ones you pick. Restart your agent afterwards.',
        },
      ],
      permissions: [
        {
          title: 'Documents folder',
          bodyHtml:
            '“SaveMe would like to access files in your Documents folder”. Click <strong>Allow</strong>: the journal lives in <code>~/Documents/SaveMe</code>. If you denied it: <strong>System Settings → Privacy &amp; Security → Files and Folders → SaveMe → Documents</strong>. You can pick another folder in the app’s settings.',
        },
        {
          title: 'Notifications',
          bodyHtml:
            'To let you know when an agent proposes a summary and is waiting for your decision. Optional; change it in <strong>System Settings → Notifications → SaveMe</strong>.',
        },
        {
          title: 'App Management',
          bodyHtml:
            'If, when updating, macOS says SaveMe was prevented from modifying apps, turn it on in <strong>System Settings → Privacy &amp; Security → App Management</strong>.',
        },
      ],
      troubleshooting: [
        {
          title: '“SaveMe is damaged and can’t be opened”',
          bodyHtml:
            'It isn’t damaged: that is how macOS flags unsigned downloaded apps. Remove the quarantine flag and open it again:',
          code: 'xattr -dr com.apple.quarantine /Applications/SaveMe.app',
        },
        {
          title: '“Open Anyway” doesn’t show up',
          bodyHtml:
            'The button only shows for about an hour after the attempt. Open SaveMe again from Applications and go back to <strong>Privacy &amp; Security</strong>. On macOS 14 or earlier, right-click → <strong>Open</strong> also works.',
        },
      ],
    },
    windows: {
      steps: [
        {
          title: 'Download the installer',
          bodyHtml:
            'The <code>-setup.exe</code> is the recommended one. The <code>.msi</code> is for company-managed installs.',
        },
        {
          title: 'Keep the download',
          bodyHtml:
            'If the browser says the file isn’t commonly downloaded, choose <strong>Keep</strong> (in Edge: <strong>… → Keep → Keep anyway</strong>).',
        },
        {
          title: 'Get past SmartScreen',
          bodyHtml:
            '“Windows protected your PC” shows up because the installer isn’t signed. Click <strong>More info</strong> and then <strong>Run anyway</strong>.',
        },
        {
          title: 'Install and follow the wizard',
          bodyHtml:
            'The installer downloads WebView2 if it is missing (Windows 11 already has it). When SaveMe opens, the wizard configures your agents.',
        },
      ],
      permissions: [
        {
          title: 'User Account Control',
          bodyHtml: 'The <code>.msi</code> asks for administrator permission to install into Program Files. Accept with <strong>Yes</strong>.',
        },
        {
          title: 'Notifications',
          bodyHtml:
            'To tell you about pending proposals. Manage them in <strong>Settings → System → Notifications → SaveMe</strong>.',
        },
      ],
      troubleshooting: [
        {
          title: 'The antivirus quarantines it',
          bodyHtml:
            'It sometimes happens with new unsigned binaries. The code is on GitHub and the installers are built on GitHub Actions; you can restore it from <strong>Windows Security → Virus &amp; threat protection → Protection history</strong>.',
        },
      ],
    },
    linux: {
      steps: [
        {
          title: 'Debian, Ubuntu and derivatives',
          bodyHtml: 'Install the <code>.deb</code> with apt, which resolves the dependencies:',
          code: 'sudo apt install ./SaveMe_*_amd64.deb',
        },
        {
          title: 'Any other distribution',
          bodyHtml: 'Make the AppImage executable and open it:',
          code: 'chmod +x SaveMe_*_amd64.AppImage\n./SaveMe_*_amd64.AppImage',
        },
        {
          title: 'Follow the wizard',
          bodyHtml: 'It detects your agents and configures the MCP server in the ones you pick.',
        },
      ],
      permissions: [
        {
          title: 'No special permissions',
          bodyHtml:
            'SaveMe works in <code>~/Documents/SaveMe</code> and its own config, and only touches your agents’ config files when you ask it to, keeping a backup. Its internal service listens on <code>127.0.0.1</code> only.',
        },
      ],
      troubleshooting: [
        {
          title: 'The AppImage won’t start',
          bodyHtml: 'Recent distributions don’t ship FUSE 2. On Ubuntu 24.04:',
          code: 'sudo apt install libfuse2t64',
        },
      ],
    },
    cli: {
      title: 'From the terminal',
      bodyHtml:
        'The wizard does it for you, but if you prefer the command line, the <code>saveme</code> binary diagnoses and configures any client:',
      code: 'saveme doctor\nsaveme mcp-config --list\nsaveme mcp-config --provider claude-code --write',
    },
  },
  openSource: {
    kicker: 'open source',
    title: 'The code is on GitHub',
    lead:
      'Read it, build it yourself, open an issue or send a pull request. The installers are built on GitHub Actions from each tag, so what you download comes from that code.',
    star: 'View the repository',
    issues: 'Report an issue',
    buildTitle: 'Build from source',
    build: 'git clone https://github.com/ismaelosuna7824/saveme\ncd saveme\nmake setup\nmake dev',
    stack: 'Go · Tauri v2 · React · SQLite',
  },
  footer: {
    tagline: 'Technical project journal, in markdown.',
    releases: 'Releases',
    repo: 'Repository',
    docs: 'Docs',
  },
  os: { macos: 'macOS', windows: 'Windows', linux: 'Linux' },
  common: { copy: 'copy', copied: 'copied', close: 'Close' },
}

export default en
