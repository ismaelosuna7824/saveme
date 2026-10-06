/**
 * Diccionario en español. Es la forma de referencia: `en.ts` se declara contra
 * `Dict`, así que una clave que falte o sobre en inglés rompe `astro check`.
 *
 * Los textos con `html` en el nombre se pintan con `set:html`: llevan `<code>` o
 * `<strong>` escritos aquí, nunca contenido que venga de fuera.
 */
const es = {
  meta: {
    title: 'SaveMe — el diario técnico de tus proyectos, en markdown',
    description:
      'Guarda qué se hizo y por qué después de cada feature, fix o decisión. Lo escribe tu agente de IA vía MCP, siempre te pregunta dónde guardarlo, y queda como un .md tuyo. Open source para macOS, Windows y Linux.',
  },
  nav: {
    why: 'Para qué',
    features: 'Beneficios',
    screenshots: 'Capturas',
    download: 'Descargar',
    install: 'Instalar',
    github: 'GitHub',
    language: 'Idioma',
  },
  hero: {
    eyebrow: 'open source · local · MCP',
    titleHtml: 'Dentro de seis meses sabrás <em>qué se hizo y por qué</em>.',
    lead:
      'SaveMe es un diario técnico de proyecto en markdown. Al terminar un cambio le pides a tu agente de IA que guarde un resumen; SaveMe te pregunta dónde y lo deja como un archivo .md en tu disco.',
    downloadFor: 'Descargar para {os}',
    allDownloads: 'Todas las descargas',
    viewOnGithub: 'Ver en GitHub',
    latest: 'Última versión',
    loading: 'buscando…',
    seeOnGithub: 'ver en GitHub',
    free: 'Gratis y open source. Sin cuenta, sin nube.',
  },
  why: {
    kicker: 'para qué sirve',
    title: 'El porqué se pierde. SaveMe lo guarda.',
    lead:
      'El código cuenta qué hace. El historial de git cuenta qué cambió. Ninguno de los dos cuenta por qué se decidió así, qué se descartó o qué quedó pendiente, y el chat con el agente donde se habló muere con la sesión.',
    cards: [
      {
        title: 'Seis meses después',
        body: 'Vuelves a un proyecto y no recuerdas por qué el watcher tiene un retardo o por qué se eligió SQLite. El resumen está ahí, con contexto, alternativas y riesgos.',
      },
      {
        title: 'Más allá de git log',
        body: 'Frases humanas por feature, fix y decisión, agrupadas por proyecto y categoría. Salen notas de versión que alguien puede leer.',
      },
      {
        title: 'Lo escribe tu agente',
        body: 'Tú no redactas nada: el agente que ya usas conoce el cambio y escribe el resumen. Tú solo decides dónde va.',
      },
    ],
  },
  how: {
    kicker: 'cómo funciona',
    title: 'Tres pasos, y tú decides el último',
    flow: { agent: 'agente', propose: 'propone', ask: 'pregunta', you: 'tú', confirm: 'confirma' },
    steps: [
      {
        title: 'Pídeselo a tu agente',
        bodyHtml: 'Al terminar un cambio: <code>«guarda un resumen en SaveMe»</code>. El agente habla con SaveMe por MCP.',
      },
      {
        title: 'SaveMe te pregunta dónde',
        bodyHtml:
          'El agente propone proyecto y categoría. Nada se escribe hasta que aceptas o eliges otro sitio, en el chat o en el <strong>Inbox</strong> de la app.',
      },
      {
        title: 'Un .md que es tuyo',
        bodyHtml:
          'El resumen queda en <code>~/Documents/SaveMe/&lt;proyecto&gt;/&lt;categoría&gt;/</code>. Se lee con cualquier editor y se versiona con git.',
      },
    ],
  },
  features: {
    kicker: 'beneficios',
    title: 'Lo que te da',
    items: [
      {
        title: 'Tus archivos, tu disco',
        body: 'Cada resumen es un markdown normal. El archivo es la fuente de verdad; la app es una forma cómoda de leerlo. Sin cuenta, sin nube, sin bloqueo.',
      },
      {
        title: 'Nunca escribe sin preguntarte',
        body: 'Proponer no toca el disco. Solo escribe una confirmación con un token de un solo uso, y queda registrado si lo aprobó una persona o el agente.',
      },
      {
        title: 'Funciona con la app cerrada',
        body: 'El servidor MCP es el mismo binario y habla directo con los archivos. Al abrir la app, lo nuevo ya está.',
      },
      {
        title: '26 clientes de IA',
        body: 'Claude Code, Cursor, Codex, Copilot, Gemini CLI, OpenCode y más. El asistente de primer arranque los detecta y los configura por ti, con copia de seguridad.',
      },
      {
        title: '¿Dónde lo dejamos?',
        body: 'El pulso de cada proyecto: la última actividad, los archivos tocados, lo pendiente y un mapa de actividad de un año.',
      },
      {
        title: 'Notas de versión solas',
        body: 'Elige un rango de fechas y sale un changelog en markdown agrupado por categoría. También desde la terminal: saveme changelog.',
      },
      {
        title: 'Un editor de verdad',
        body: 'Vista previa en vivo como Obsidian, diagramas Mermaid, casillas que se marcan, modo vim opcional y búsqueda de texto completo.',
      },
      {
        title: 'Comparte y exporta',
        body: 'Guarda un resumen como markdown limpio, compártelo en Slack, X o LinkedIn, o exporta un proyecto entero en un solo documento.',
      },
      {
        title: 'A tu gusto',
        body: '17 temas con contraste comprobado, imagen de fondo, iconos de proyecto en píxeles, español e inglés. Se actualiza sola con paquetes firmados.',
      },
    ],
  },
  screenshots: {
    kicker: 'capturas',
    title: 'Así se ve',
    items: {
      editor: {
        title: 'El editor',
        caption: 'Vista previa en vivo con diagramas Mermaid, tareas y código. La sintaxis solo aparece en la línea del cursor.',
      },
      inbox: {
        title: 'Inbox',
        caption: 'Las propuestas del agente esperan tu decisión: acepta el destino o elige otro.',
      },
      pulse: {
        title: 'Pulso del proyecto',
        caption: 'Dónde lo dejaste, lo pendiente y un año de trabajo de un vistazo.',
      },
      onboarding: {
        title: 'Primer arranque',
        caption: 'El asistente detecta tus agentes y configura el servidor MCP en los que elijas.',
      },
      palette: {
        title: 'Paleta de comandos',
        caption: 'Cmd+K para saltar a cualquier proyecto, resumen o acción.',
      },
      settings: {
        title: 'Temas',
        caption: '17 paletas completas, de phosphor a paper.',
      },
      background: {
        title: 'Imagen de fondo',
        caption: 'Tu foto detrás de toda la ventana. Las barras y las tarjetas se vuelven cristal para que el texto se siga leyendo.',
      },
    },
  },
  clients: {
    kicker: 'compatible con',
    title: 'Funciona con el agente que ya usas',
    lead: 'SaveMe expone un servidor MCP. La app y la CLI saben configurar estos clientes, y cualquier otro con el modo de cliente personalizado.',
  },
  download: {
    kicker: 'descargar',
    title: 'Plataformas soportadas',
    lead: 'Los enlaces apuntan siempre a la última versión publicada en GitHub. La app se actualiza sola después.',
    version: 'Versión',
    allReleases: 'Ver todas las versiones',
    recommended: 'recomendado',
    howToInstall: 'Cómo instalar en {os}',
    platforms: {
      macos: {
        name: 'macOS',
        requirements: 'macOS 10.15 o superior · universal (Apple Silicon e Intel)',
      },
      windows: {
        name: 'Windows',
        requirements: 'Windows 10 y 11 · x64',
      },
      linux: {
        name: 'Linux',
        requirements: 'x64 · .deb para Debian/Ubuntu, AppImage para el resto',
      },
    },
    assets: {
      dmg: 'Instalador .dmg',
      exe: 'Instalador .exe',
      msi: 'Paquete .msi',
      deb: 'Paquete .deb',
      appimage: 'AppImage',
    },
  },
  install: {
    kicker: 'instalar',
    title: 'Cómo instalar',
    lead:
      'SaveMe es open source y no está firmado con un certificado de pago de Apple ni de Microsoft. Por eso el sistema avisa la primera vez y te pide confirmar. Es normal: aquí está cada paso.',
    tabs: { macos: 'macOS', windows: 'Windows', linux: 'Linux' },
    permissionsTitle: 'Permisos que te puede pedir',
    troubleshootingTitle: 'Si algo no va',
    macos: {
      steps: [
        {
          title: 'Descarga el .dmg',
          bodyHtml: 'Uno solo para todos los Mac: Apple Silicon e Intel.',
        },
        {
          title: 'Arrástralo a Aplicaciones',
          bodyHtml: 'Abre el <code>.dmg</code> y arrastra <strong>SaveMe</strong> a la carpeta <strong>Aplicaciones</strong>.',
        },
        {
          title: 'Ábrelo y autorízalo en Privacidad y seguridad',
          bodyHtml:
            'La primera vez macOS dice que no puede verificar al desarrollador y no lo abre. Cierra ese aviso (sin moverlo a la Papelera), ve a <strong>Ajustes del Sistema → Privacidad y seguridad</strong>, baja hasta la sección Seguridad, pulsa <strong>Abrir igualmente</strong> junto al mensaje de que SaveMe se ha bloqueado y confirma con tu contraseña. Solo hace falta una vez.',
        },
        {
          title: 'Sigue el asistente',
          bodyHtml:
            'Te explica qué va a hacer, muestra qué agentes tienes instalados y configura el servidor MCP en los que elijas. Reinicia el agente después.',
        },
      ],
      permissions: [
        {
          title: 'Carpeta Documentos',
          bodyHtml:
            '«SaveMe quiere acceder a archivos de tu carpeta Documentos». Pulsa <strong>Permitir</strong>: el diario vive en <code>~/Documents/SaveMe</code>. Si lo denegaste: <strong>Ajustes del Sistema → Privacidad y seguridad → Archivos y carpetas → SaveMe → Documentos</strong>. Puedes elegir otra carpeta en los ajustes de la app.',
        },
        {
          title: 'Notificaciones',
          bodyHtml:
            'Para avisarte cuando un agente propone un resumen y espera tu decisión. Opcional; se cambia en <strong>Ajustes del Sistema → Notificaciones → SaveMe</strong>.',
        },
        {
          title: 'Gestión de apps',
          bodyHtml:
            'Si al actualizar macOS dice que se impidió a SaveMe modificar apps, actívalo en <strong>Ajustes del Sistema → Privacidad y seguridad → Gestión de apps</strong>.',
        },
      ],
      troubleshooting: [
        {
          title: '«SaveMe está dañado y no se puede abrir»',
          bodyHtml:
            'No está dañado: macOS marca así las apps descargadas sin firmar. Quita la marca de cuarentena y ábrela de nuevo:',
          code: 'xattr -dr com.apple.quarantine /Applications/SaveMe.app',
        },
        {
          title: 'No aparece «Abrir igualmente»',
          bodyHtml:
            'El botón sale solo durante una hora después del intento. Abre SaveMe otra vez desde Aplicaciones y vuelve a <strong>Privacidad y seguridad</strong>. En macOS 14 o anterior también vale clic derecho → <strong>Abrir</strong>.',
        },
      ],
    },
    windows: {
      steps: [
        {
          title: 'Descarga el instalador',
          bodyHtml:
            'El <code>-setup.exe</code> es el recomendado. El <code>.msi</code> es para instalaciones gestionadas por empresa.',
        },
        {
          title: 'Confirma la descarga',
          bodyHtml:
            'Si el navegador dice que el archivo no se descarga a menudo, elige <strong>Conservar</strong> (en Edge: <strong>… → Conservar → Conservar de todos modos</strong>).',
        },
        {
          title: 'Pasa el aviso de SmartScreen',
          bodyHtml:
            '«Windows protegió su PC» aparece porque el instalador no está firmado. Pulsa <strong>Más información</strong> y después <strong>Ejecutar de todas formas</strong>.',
        },
        {
          title: 'Instala y sigue el asistente',
          bodyHtml:
            'El instalador descarga WebView2 si falta (Windows 11 ya lo trae). Al abrir SaveMe, el asistente configura tus agentes.',
        },
      ],
      permissions: [
        {
          title: 'Control de cuentas de usuario',
          bodyHtml: 'El <code>.msi</code> pide permiso de administrador para instalar en Archivos de programa. Acepta con <strong>Sí</strong>.',
        },
        {
          title: 'Notificaciones',
          bodyHtml:
            'Para avisarte de las propuestas pendientes. Se gestionan en <strong>Configuración → Sistema → Notificaciones → SaveMe</strong>.',
        },
      ],
      troubleshooting: [
        {
          title: 'El antivirus lo pone en cuarentena',
          bodyHtml:
            'Pasa a veces con binarios nuevos sin firmar. El código está en GitHub y los instaladores se compilan en GitHub Actions; puedes restaurarlo desde <strong>Seguridad de Windows → Protección contra virus y amenazas → Historial de protección</strong>.',
        },
      ],
    },
    linux: {
      steps: [
        {
          title: 'Debian, Ubuntu y derivadas',
          bodyHtml: 'Instala el <code>.deb</code> con apt, que resuelve las dependencias:',
          code: 'sudo apt install ./SaveMe_*_amd64.deb',
        },
        {
          title: 'Cualquier otra distribución',
          bodyHtml: 'Dale permiso de ejecución al AppImage y ábrelo:',
          code: 'chmod +x SaveMe_*_amd64.AppImage\n./SaveMe_*_amd64.AppImage',
        },
        {
          title: 'Sigue el asistente',
          bodyHtml: 'Detecta tus agentes y configura el servidor MCP en los que elijas.',
        },
      ],
      permissions: [
        {
          title: 'Sin permisos especiales',
          bodyHtml:
            'SaveMe trabaja en <code>~/Documents/SaveMe</code> y en su configuración, y solo toca la configuración de tus agentes cuando se lo pides, con copia de seguridad. El servicio interno escucha únicamente en <code>127.0.0.1</code>.',
        },
      ],
      troubleshooting: [
        {
          title: 'El AppImage no arranca',
          bodyHtml: 'Las distribuciones recientes no traen FUSE 2. En Ubuntu 24.04:',
          code: 'sudo apt install libfuse2t64',
        },
      ],
    },
    cli: {
      title: 'Desde la terminal',
      bodyHtml:
        'El asistente lo hace por ti, pero si prefieres la línea de comandos, el binario <code>saveme</code> diagnostica y configura cualquier cliente:',
      code: 'saveme doctor\nsaveme mcp-config --list\nsaveme mcp-config --provider claude-code --write',
    },
  },
  openSource: {
    kicker: 'open source',
    title: 'El código está en GitHub',
    lead:
      'Léelo, compílalo tú mismo, abre un issue o manda un pull request. Los instaladores se generan en GitHub Actions a partir de cada tag, así que lo que descargas sale de ese código.',
    star: 'Ver el repositorio',
    issues: 'Reportar un problema',
    buildTitle: 'Compilar desde el código',
    build: 'git clone https://github.com/ismaelosuna7824/saveme\ncd saveme\nmake setup\nmake dev',
    stack: 'Go · Tauri v2 · React · SQLite',
  },
  footer: {
    tagline: 'Diario técnico de proyecto, en markdown.',
    releases: 'Versiones',
    repo: 'Repositorio',
    docs: 'Documentación',
  },
  os: { macos: 'macOS', windows: 'Windows', linux: 'Linux' },
  common: { copy: 'copiar', copied: 'copiado', close: 'Cerrar' },
}

export type Dict = typeof es
export default es
