// SaveMe — shell de escritorio.
//
// Este proceso NO tiene lógica de dominio. Su único trabajo es:
//
//   1. localizar el binario del core de Go (el "sidecar"),
//   2. lanzarlo si no hay ya uno sano escuchando,
//   3. decirle a la interfaz en qué puerto quedó,
//   4. matarlo al salir para no dejar procesos huérfanos.
//
// Todo el resto (SQLite, filesystem, API, MCP) vive en el binario de Go, que es
// el mismo que usa un agente cuando corre `saveme mcp`. Esa es la razón de que
// la app y el MCP nunca puedan divergir: son el mismo programa.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Puerto preferido del core. Si está ocupado, el propio core prueba el
/// siguiente y lo publica en daemon.json.
const DEFAULT_PORT: u16 = 7411;

/// Estado compartido: el proceso hijo, para poder matarlo al salir.
#[derive(Default)]
struct Sidecar(Mutex<Option<Child>>);

fn main() {
    let builder = tauri::Builder::default().manage(Sidecar::default());

    // Actualizaciones desde la propia app. Se registran en Rust y la interfaz los
    // usa desde JavaScript: el plugin es quien habla con el servidor de
    // actualizaciones y quien verifica la firma, y la interfaz solo decide cuándo
    // preguntar y qué enseñar.
    //
    // Van bajo `#[cfg(desktop)]` porque el actualizador no existe en móvil, y se
    // encadena con un `let` que ensombrece al anterior —igual que la barra de
    // título de macOS más abajo— para que en el resto de plataformas estas
    // llamadas simplemente no existan, sin dejar una variable `mut` sin usar.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .setup(|app| {
            let handle = app.handle().clone();
            let port = start_core(&handle);
            let api_base = format!("http://127.0.0.1:{port}/api");

            // La interfaz se construye aquí (y no en tauri.conf.json) para poder
            // inyectarle el puerto real antes de que cargue. En producción la
            // página se sirve por el protocolo de Tauri, así que una ruta
            // relativa "/api" no apuntaría al core: necesita la URL absoluta.
            //
            // `macos` va aquí porque la interfaz necesita saberlo para dejar
            // sitio a los botones de la ventana: en macOS la barra de título
            // nativa se oculta (ver abajo) y los semáforos quedan flotando
            // encima de la barra de la app.
            let init_script = format!(
                "window.__SAVEME__ = {{ apiBase: {api_base:?}, inTauri: true, corePort: {port}, macos: {} }};",
                cfg!(target_os = "macos")
            );

            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("SaveMe")
                .inner_size(1280.0, 820.0)
                .min_inner_size(900.0, 600.0)
                // Alpha **0**, no 255: este color lo pinta la ventana por detrás
                // del webview, así que con alpha opaco tapaba el escritorio y la
                // translucidez del CSS no servía de nada. En cuanto el webview
                // pinta, el color lo pone el tema.
                .background_color(tauri::window::Color(11, 14, 15, 0))
                // Ventana translúcida: con esto el webview deja pasar lo que hay
                // detrás, y la interfaz decide cuánto con el nivel de opacidad que
                // elija el usuario. Con la opacidad al 100 % el resultado es
                // idéntico al de una ventana opaca, así que por defecto no cambia
                // nada.
                //
                // En macOS exige la feature `macos-private-api` (ver Cargo.toml y
                // `macOSPrivateApi` en tauri.conf.json).
                .transparent(true)
                .initialization_script(&init_script);

            // En macOS la barra de título se deja en modo `Overlay` con el título
            // oculto: desaparece la franja gris del sistema y su «SaveMe»
            // centrado, el contenido llega hasta arriba y la barra superior de la
            // app hace de barra de título. **Los semáforos siguen siendo los
            // nativos** —cerrar, minimizar, zoom, pantalla completa y el menú de
            // la ventana siguen siendo los del sistema—, solo que flotan encima
            // de nuestro contenido en vez de en una franja aparte. Por eso la
            // barra reserva sitio a la izquierda.
            //
            // Se encadena con un `let` que ensombrece al anterior en vez de con
            // `mut` + `#[cfg]`: así en el resto de plataformas estas dos llamadas
            // simplemente no existen, sin dejar una variable `mut` sin usar.
            #[cfg(target_os = "macos")]
            let builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true);

            builder.build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("no pude construir la aplicación Tauri")
        .run(|app_handle, event| {
            // Matar el core al salir. Sin esto quedaría un daemon escuchando y
            // una siguiente ejecución se encontraría el puerto ocupado.
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<Sidecar>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(child) = guard.as_mut() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                        *guard = None;
                    }
                }
            }
        });
}

/// Arranca el core y devuelve el puerto en el que escucha.
///
/// Cada instancia de la app lanza y POSEE su propio core. Reutilizar un core que
/// ya estuviera escuchando parecía un ahorro y era un fallo silencioso: la
/// instancia que lo había lanzado se lo llevaba consigo al cerrarse, y la otra se
/// quedaba sin core mostrando la pantalla de arranque indefinidamente. Pasa de
/// verdad cada vez que `tauri dev` reconstruye la app, y pasaría al abrir SaveMe
/// dos veces.
///
/// Lanzar el propio es determinista y no necesita coordinación entre procesos: si
/// el puerto preferido está ocupado, el core prueba el siguiente y lo anuncia por
/// stdout, que es justo el mecanismo que ya existía.
fn start_core(app: &tauri::AppHandle) -> u16 {
    let Some(binary) = find_core_binary(app) else {
        log("no encontré el binario del core; la interfaz mostrará el diagnóstico");
        return DEFAULT_PORT;
    };
    log(&format!("lanzando el core: {}", binary.display()));

    let mut command = Command::new(&binary);
    command
        .arg("serve")
        .arg("--port")
        .arg(DEFAULT_PORT.to_string())
        // `--parent-stdin` ata la vida del core a la nuestra. El pipe se queda
        // abierto mientras vivamos (el ChildStdin viaja dentro del Child, que
        // guardamos en el estado): si la app muere de golpe y no llega a ejecutar
        // su manejador de salida, el sistema cierra el pipe igualmente, el core
        // lee EOF y se apaga solo. Sin esto, un crash dejaba un daemon huérfano
        // ocupando el puerto.
        .arg("--parent-stdin")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // El log del core es útil mientras se desarrolla, pero ruidoso en uso
    // normal. Se activa con SAVEME_CORE_VERBOSE=1 sin recompilar nada.
    if std::env::var("SAVEME_CORE_VERBOSE").is_ok_and(|v| v != "0" && !v.is_empty()) {
        command.arg("--verbose");
    }

    match command.spawn() {
        Ok(mut child) => {
            // El core imprime "SAVEME_READY <url>" en stdout cuando ya atiende.
            // Leerlo evita tener que adivinar cuánto tarda en abrir SQLite.
            let ready_port = child.stdout.take().and_then(|stdout| {
                let rx = spawn_stdout_reader(stdout);
                let deadline = Instant::now() + Duration::from_secs(20);
                while Instant::now() < deadline {
                    match rx.recv_timeout(Duration::from_millis(200)) {
                        Ok(port) => return Some(port),
                        Err(RecvTimeoutError::Timeout) => {
                            // Si el core ya terminó, no tiene sentido agotar el
                            // plazo: casi siempre es un fallo al abrir el
                            // workspace, y el motivo está en el log que ya se
                            // reenvió. Callarlo dejaba al usuario mirando una
                            // pantalla de arranque sin ninguna explicación.
                            if let Ok(Some(status)) = child.try_wait() {
                                log(&format!(
                                    "el core terminó antes de estar listo ({status}); el motivo está en su log de arriba"
                                ));
                                return None;
                            }
                        }
                        Err(RecvTimeoutError::Disconnected) => {
                            log("el core cerró su salida sin anunciarse; revisa su log de arriba");
                            return None;
                        }
                    }
                }
                log("el core tardó demasiado en anunciarse; compruebo si aun así está escuchando");
                None
            });

            // stderr se drena siempre. El core loguea por ahí de forma continua:
            // sin este hilo, tarde o temprano el pipe se llena y el daemon se
            // queda congelado escribiendo, que es un fallo dificilísimo de
            // diagnosticar porque la app simplemente deja de responder.
            if let Some(stderr) = child.stderr.take() {
                drain_lines(stderr, "core");
            }

            let port = ready_port.unwrap_or_else(|| {
                // Sin la línea de READY se busca un core DE VERDAD, no un puerto
                // abierto cualquiera: si otro programa ocupa el 7411, apuntar ahí
                // daría un fallo desconcertante y muy difícil de atribuir.
                for candidate in DEFAULT_PORT..DEFAULT_PORT + 25 {
                    if is_our_core(candidate) {
                        return candidate;
                    }
                }
                DEFAULT_PORT
            });

            if let Some(state) = app.try_state::<Sidecar>() {
                if let Ok(mut guard) = state.0.lock() {
                    *guard = Some(child);
                }
            }
            port
        }
        Err(err) => {
            log(&format!("no pude lanzar el core: {err}"));
            DEFAULT_PORT
        }
    }
}

/// Localiza el binario del core.
///
/// El orden importa: en desarrollo el binario vive en src-tauri/binaries con el
/// sufijo del triple; empaquetado, Tauri lo deja junto al ejecutable principal.
fn find_core_binary(app: &tauri::AppHandle) -> Option<PathBuf> {
    let triple = env!("SAVEME_TARGET_TRIPLE");
    let exe_name = if cfg!(windows) { "saveme.exe" } else { "saveme" };

    let mut candidates: Vec<PathBuf> = Vec::new();

    // 0. Override explícito, para desarrollo y para las pruebas.
    if let Ok(explicit) = std::env::var("SAVEME_BIN") {
        candidates.push(PathBuf::from(explicit));
    }

    // 1. Junto al ejecutable de la app (caso empaquetado).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(exe_name));
            candidates.push(dir.join(format!("{exe_name}-{triple}")));
            // En macOS el binario vive en Contents/MacOS y los recursos del
            // bundle pueden estar un nivel más arriba.
            if let Some(contents) = dir.parent() {
                candidates.push(contents.join("Resources").join(exe_name));
            }
        }
    }

    // 2. Directorio de binarios del proyecto (caso desarrollo).
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join("binaries").join(format!("{exe_name}-{triple}")));
    candidates.push(manifest.join("binaries").join(exe_name));
    candidates.push(manifest.join("..").join("backend").join("bin").join(exe_name));

    // 3. Por si el usuario lo instaló en el PATH.
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            candidates.push(dir.join(exe_name));
        }
    }

    let _ = app; // el handle no hace falta todavía; se mantiene por claridad
    candidates.into_iter().find(|p| p.is_file())
}

/// Lee stdout del core en un hilo aparte y avisa por un canal en cuanto el core
/// anuncia que está escuchando.
///
/// Se hace en un hilo, y no con un readline con fecha límite, porque un readline
/// bloqueante no se puede cancelar: si el core no imprimiera nada (binario
/// equivocado, crash silencioso), la app se quedaría esperando para siempre y la
/// ventana no abriría jamás. Con el canal, `recv_timeout` sí caduca.
///
/// El hilo sigue vivo después de anunciar el puerto, porque un pipe que nadie
/// lee acaba bloqueando al proceso hijo cuando se llena el buffer del sistema.
fn spawn_stdout_reader(stdout: ChildStdout) -> Receiver<u16> {
    let (tx, rx) = channel();
    std::thread::spawn(move || {
        let mut announced = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if !announced {
                if let Some(port) = line.trim().strip_prefix("SAVEME_READY ").and_then(parse_port) {
                    // Si el receptor ya no escucha (timeout agotado), no pasa
                    // nada: el core arrancó igual y el escaneo de puertos lo
                    // encontrará.
                    let _ = tx.send(port);
                    announced = true;
                }
            }
            log(&format!("core: {line}"));
        }
    });
    rx
}

/// Reenvía a stderr del shell todo lo que el hijo escriba en `reader`.
fn drain_lines<R: std::io::Read + Send + 'static>(reader: R, label: &'static str) {
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            log(&format!("{label}: {line}"));
        }
    });
}

fn parse_port(url: &str) -> Option<u16> {
    url.rsplit(':').next()?.trim_end_matches('/').parse().ok()
}

/// Comprueba si en ese puerto responde NUESTRO core.
///
/// No basta con que el puerto esté abierto: cualquier otro programa puede
/// ocuparlo, y entonces la ventana apuntaría a un servidor ajeno y fallaría de
/// una forma muy difícil de atribuir. Se le pide /api/health y se comprueba que
/// la respuesta sea la del core, sin arrastrar una dependencia HTTP por esto.
fn is_our_core(port: u16) -> bool {
    let Ok(address) = format!("127.0.0.1:{port}").parse() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(400)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(600)));

    let request =
        format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }
    // Estos dos campos los devuelve el core y no aparecen por casualidad en la
    // respuesta de otro servidor.
    response.contains("\"ok\":true") && response.contains("using_fts")
}

fn log(message: &str) {
    // stderr, para no mezclarse con nada que la interfaz espere en stdout.
    eprintln!("[saveme-shell] {message}");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    /// Un puerto ocupado por otro programa NO puede confundirse con el core.
    ///
    /// Es la prueba de la regresión que dejaba la ventana en la pantalla de
    /// arranque: el shell solo comprobaba que el puerto estuviera abierto, así que
    /// cualquier otro servidor pasaba por el core y la app le hablaba a él.
    #[test]
    fn a_foreign_listener_is_not_our_core() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("no pude abrir un puerto");
        let port = listener.local_addr().expect("sin dirección").port();

        std::thread::spawn(move || {
            for incoming in listener.incoming() {
                let Ok(mut stream) = incoming else { break };
                let mut buffer = [0u8; 512];
                let _ = stream.read(&mut buffer);
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 17\r\nConnection: close\r\n\r\n{\"algo\":\"ajeno\"}",
                );
            }
        });

        assert!(
            !is_our_core(port),
            "un servidor ajeno en el puerto {port} no debe pasar por el core"
        );
    }

    #[test]
    fn a_closed_port_is_not_our_core() {
        assert!(!is_our_core(1), "un puerto cerrado no puede ser el core");
    }

    #[test]
    fn parse_port_reads_the_url() {
        assert_eq!(parse_port("http://127.0.0.1:7411"), Some(7411));
        assert_eq!(parse_port("http://127.0.0.1:7411/"), Some(7411));
        assert_eq!(parse_port("basura"), None);
        assert_eq!(parse_port(""), None);
    }
}
