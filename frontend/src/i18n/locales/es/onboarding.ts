/**
 * Textos de `onboarding`. Ver `es/common.ts` para el criterio.
 *
 * Nota sobre los plurales: `translate()` busca `clave_one` / `clave_other`
 * concatenando el sufijo, pero `t()` recibe la clave sin sufijo. Por eso cada
 * plural declara también la clave base (la forma de `other`); sin ella el
 * compilador no admitiría la llamada `t('…', { count })`.
 */
export const onboarding = {
  // Notas de cada cliente MCP. El core también las manda, en español
  // (`ProviderReport.note`), y estas son las mismas; viven aquí para que la
  // interfaz en inglés no enseñe párrafos en español. Si cambias una nota en
  // `internal/mcpconfig/provider.go`, cámbiala también aquí.
  // Los clientes sin nota no aparecen: no hay nada que traducir.
  providerNote: {
    'codex': 'En TOML la sección es [mcp_servers.saveme] y el entorno va en una subsección [mcp_servers.saveme.env].',
    'claude-code': 'Claude Code tiene tres ámbitos: local (solo este proyecto), project (se comparte por git) y user (todos tus proyectos). Para que funcione en cualquier proyecto, este último es el que quieres. Se configura con su propio comando, no editando ~/.claude.json, que es su archivo de estado.',
    'copilot': 'Lo leen GitHub Copilot CLI y VS Code: es el destino «Copilot Global» que VS Code recomienda. Si defines COPILOT_HOME, el archivo va en esa carpeta.',
    'vscode-copilot': 'VS Code usa `servers` en vez de `mcpServers` y exige `type: "stdio"`. VS Code ya marca este destino como antiguo y recomienda el de GitHub Copilot (~/.copilot/mcp-config.json): usa ese si puedes.',
    'antigravity': 'Un solo archivo para Antigravity, Antigravity IDE y su CLI (`agy`).',
    'opencode': 'OpenCode fusiona los archivos de configuración en vez de reemplazarlos, así que este bloque convive con los MCP que ya tengas. Exige `type: "local"` y los argumentos dentro de `command`. Si el archivo es JSONC con comentarios, no se reescribe: se te da el bloque para pegar.',
    'omp': 'omp también lee la configuración de Claude Code, Codex, Gemini CLI, OpenCode y Cursor. Si SaveMe ya está en alguno no sale repetido: gana este archivo.',
    'pi': 'El MCP viene integrado en pi desde la 0.99. Si usas una extensión que registra /mcp (como pi-mcp-adapter), esa sustituye a la integrada y este archivo no se lee.',
    'kilocode': 'La CLI y las extensiones de VS Code y JetBrains comparten este archivo. Como en OpenCode, los argumentos van dentro de `command` y el entorno en `environment`. Si el archivo tiene comentarios, se te da el bloque para pegar.',
    'amp': 'Amp usa la clave `amp.mcpServers` tal cual, con el punto dentro. Si tu archivo tiene comentarios, se te da el bloque para pegar.',
    'zcode': 'Los servidores van dentro de `mcp.servers`. Si este archivo tiene alguno, Z Code deja de leer ~/.agents/mcp.json.',
    'kimi-code': 'Es el archivo de Kimi Code CLI. El Kimi CLI antiguo (~/.kimi) está archivado; `kimi migrate` pasa su configuración a este.',
    'devin': 'Lo comparten Devin CLI y Devin Desktop (antes Windsurf). Devin en la nube no puede lanzar un programa de tu equipo, así que ahí no aplica.',
    'windsurf': 'Windsurf ahora es Devin Desktop, que lee la configuración de «Devin (CLI y Desktop)». Esta ruta solo sirve en instalaciones antiguas; Devin la sigue importando, así que no estorba.',
    'hermes': 'Hermes guarda su configuración en YAML y se configura con su propio comando. El comando no admite variables de entorno: si hace falta alguna, añádela a mano en mcp_servers.saveme.env de ~/.hermes/config.yaml.',
    'deepseek': 'DeepSeek Harness registra cada servidor como una fila de su plugin MCP en cordis.patch.yml. No se escribe solo: ese archivo puede tener otras personalizaciones y la fila hay que fusionarla, no sustituir el archivo.',
    'orca': 'Orca lanza otros agentes y cada uno carga su propia configuración de MCP: configura SaveMe en los que uses dentro de Orca.',
    'monocode': 'Mono lanza otros agentes y cada uno carga su propia configuración de MCP: configura SaveMe en los que uses dentro de Mono.',
    't3code': 'T3 Code usa la configuración de los agentes que controla (Codex, Claude Code…): configura SaveMe en esos.',
    'omnigent': 'Omnigent no tiene un registro global de MCP: los servidores se declaran por agente en su YAML (`tools:` con `type: mcp`). Los agentes que envuelve cargan su propia configuración, así que basta con configurar esos.',
    'generic': 'El bloque `mcpServers` es el formato de facto. Si tu cliente usa otro, revisa su documentación.',
  },
  wizard: {
    title: 'configurar el servidor mcp',
    description:
      'Asistente para instalar el servidor MCP de SaveMe y registrarlo en tus clientes de IA.',
    emptySelection: 'marca al menos un cliente, o salta este paso',
    coreUnavailable: 'el core no responde, sin él no puedo configurar nada',
    saveFailed: 'No pude guardar que ya viste el asistente',
  },
  nav: {
    step: 'paso {current}/{total} · {title}',
    intro: 'qué va a pasar',
    providers: 'elige tus clientes',
    apply: 'aplicar',
    done: 'listo',
  },
  intro: {
    lead: {
      before: 'El servidor MCP es ',
      emphasis: 'el mismo binario que la app',
      after: ', así que funciona con SaveMe cerrada: habla directo con la base de datos y con los archivos.',
    },
    binary: {
      title: 'No hay nada que descargar',
      body: 'El binario es autocontenido (Go puro, sin CGO). No necesitas Go, Node ni nada instalado: viene dentro de la aplicación.',
    },
    ownFolder: {
      title: 'Se copia a una carpeta propia de SaveMe',
      body: 'Así las configuraciones de tus agentes no apuntan dentro de la app: si mueves o borras SaveMe, el servidor MCP sigue donde estaba.',
    },
    subcommand: {
      title: 'Se registra como `saveme mcp`',
      body: 'Los dos subcomandos —`serve` y `mcp`— resuelven el mismo workspace, y eso es lo único que tiene que coincidir.',
    },
    alreadyAt: 'el binario ya está en',
    willBeCreatedAt: 'se creará en',
    installing: 'instalando…',
    verify: 'verificar la instalación',
    install: 'instalar el servidor MCP',
    alreadyInstalled: 'Ya estaba instalado: volver a hacerlo no rompe nada.',
    nothingDownloaded: 'No descarga nada de internet: copia el binario que ya tienes.',
    readError: 'no pude leer el estado del servidor mcp',
    installError: 'no pude instalar el binario',
    onPath:
      'El binario también responde al comando `saveme`, así que las configuraciones pueden usar el nombre pelado.',
    notOnPath:
      'El binario no está en tu PATH: los clientes usarán la ruta absoluta de arriba. Funciona igual.',
  },
  providers: {
    lead: {
      before:
        'Marca en qué clientes quieres que tu agente pueda guardar resúmenes. Se les añade la entrada ',
      after:
        ' sin borrar nada de lo que ya tengan: si hay que tocar un archivo, se deja copia de seguridad.',
    },
    configure: 'configurar {name}',
    badge: {
      installed: 'instalado',
      notDetected: 'no detectado',
      configured: 'ya configurado',
      unverified: 'formato sin confirmar',
      manual: 'lo pegas tú',
    },
    cliOnly: 'se configura con un comando, no tiene archivo',
    delegated: 'sin configuración propia: usa la de los agentes que lanza',
    noPath: 'sin ruta fija: te damos el bloque para pegarlo donde tu cliente lo espere',
    generic:
      'Este no se automatiza: te damos el bloque para que lo pegues donde tu cliente lo espere.',
    selected: '{count} marcados',
    selected_one: '{count} marcado',
    selected_other: '{count} marcados',
    selectedNone: 'ninguno marcado',
    selectDetected: 'marcar los detectados',
    detected: {
      title: 'detectados en tu equipo',
      hint: 'los que encontré aquí',
    },
    undetected: {
      title: 'no detectados',
      hint: 'puedes marcarlos igual si los tienes en otro sitio',
    },
  },
  apply: {
    lead: 'El binario se instala antes de escribir nada: una configuración que apunte a uno que no existe falla en silencio.',
    configuring: 'Configurando {count} clientes.',
    configuring_one: 'Configurando un cliente.',
    configuring_other: 'Configurando {count} clientes.',
    binaryLabel: 'binario:',
    writeError: 'no pude configurar los clientes',
    action: {
      created: 'creado',
      merged: 'añadido',
      updated: 'actualizado',
      alreadyConfigured: 'ya estaba',
      manual: 'a mano',
    },
    writing: 'escribiendo…',
    notAttempted: 'no se escribió: falló la llamada',
    backupLabel: 'copia de seguridad:',
    command: 'ejecuta este comando',
    snippet: 'bloque para {name}',
    pasteIn: 'pegar en',
    snippetLoading: 'preparando el bloque…',
    snippetError: 'no pude generar el bloque',
    envFixed: 'Fija {vars} para que el MCP resuelva el mismo workspace que la app.',
    allGood: 'Ningún error. Nada más que hacer aquí.',
    failed: '{count} con error',
    failed_one: '{count} con error',
    failed_other: '{count} con error',
    retryFailed: 'reintentar los que fallaron',
    manualNote:
      'Un cliente queda en manual: copia el comando o el bloque y pégalo tú. No es un fallo.',
    manualNote_one:
      'Un cliente queda en manual: copia el comando o el bloque y pégalo tú. No es un fallo.',
    manualNote_other:
      '{count} clientes quedan en manual: copia el comando o el bloque y pégalo tú. No es un fallo.',
  },
  done: {
    lead: 'Ya está. El servidor MCP y las configuraciones viven fuera de la app, así que seguirán funcionando con SaveMe cerrada.',
    restart: {
      title: 'Reinicia el cliente que configuraste',
      body: 'Los clientes leen su configuración de MCP al arrancar. Hasta que no lo reinicies, las tools de SaveMe no aparecen.',
    },
    guide: {
      title: 'Enséñale el flujo al agente',
      body: 'Una línea en el archivo de instrucciones de tu proyecto (o en el global de tu agente). El texto explica el flujo de dos fases, cómo escribir un resumen que se entienda dentro de seis meses (con diagramas cuando ayudan) y la taxonomía de categorías.',
      label: 'en la raíz de tu proyecto',
    },
    check: {
      title: 'comprobar que quedó bien',
      before: 'Abre tu agente y pídele ',
      emphasis: '«guarda un resumen de lo que acabamos de hacer»',
      after:
        '. La propuesta aparecerá en el inbox para que tú decidas dónde se escribe: sin tu confirmación no se escribe nada.',
    },
    reopen:
      'Puedes volver a este asistente cuando quieras desde la paleta de comandos (Cmd+K) → «configurar el MCP en otros agentes».',
  },
  copy: {
    success: 'Copiado al portapapeles',
    error: 'No pude usar el portapapeles',
    errorHint: 'Dejé el texto seleccionado: cópialo con Cmd/Ctrl+C.',
  },
} as const
