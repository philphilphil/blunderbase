use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

use tauri::{
    menu::{AboutMetadataBuilder, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    webview::NewWindowResponse,
    window::{ProgressBarState, ProgressBarStatus},
    AppHandle, Manager, RunEvent, Runtime, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

#[derive(serde::Deserialize)]
struct NotificationRequest {
    title: String,
    body: String,
}

#[derive(serde::Deserialize)]
struct ProgressRequest {
    status: String,
    progress: Option<u64>,
}

#[derive(serde::Deserialize)]
struct OpenRequest {
    url: String,
}

const BACKEND_READY_ATTEMPTS: usize = 240;
const BACKEND_READY_DELAY: Duration = Duration::from_millis(100);
const MANUAL_WINDOW: &str = "manual";

struct BackendChild(Mutex<Option<Child>>);

fn feedback_token() -> String {
    format!(
        "{:032x}{:032x}",
        rand::random::<u128>(),
        rand::random::<u128>()
    )
}

fn read_http_request(stream: &mut TcpStream) -> Option<(String, String, Vec<u8>)> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut request = Vec::with_capacity(2048);
    let mut chunk = [0_u8; 2048];
    let (header_end, content_length) = loop {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 || request.len() + read > 16_384 {
            return None;
        }
        request.extend_from_slice(&chunk[..read]);
        let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n") else {
            continue;
        };
        let headers = String::from_utf8_lossy(&request[..header_end]);
        let content_length = headers
            .lines()
            .filter_map(|line| line.split_once(':'))
            .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
            .and_then(|(_, value)| value.trim().parse::<usize>().ok())
            .unwrap_or(0);
        if content_length > 8_192 {
            return None;
        }
        break (header_end, content_length);
    };
    let body_start = header_end + 4;
    while request.len() < body_start + content_length {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 || request.len() + read > 16_384 {
            return None;
        }
        request.extend_from_slice(&chunk[..read]);
    }

    let headers = String::from_utf8_lossy(&request[..header_end]);
    let target = headers
        .lines()
        .next()?
        .split_whitespace()
        .nth(1)?
        .to_owned();
    let origin = headers
        .lines()
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.eq_ignore_ascii_case("origin"))?
        .1
        .trim()
        .to_owned();
    Some((
        target,
        origin,
        request[body_start..body_start + content_length].to_vec(),
    ))
}

fn respond(stream: &mut TcpStream, status: &str, origin: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nAccess-Control-Allow-Origin: {origin}\r\nVary: Origin\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
}

fn run_feedback_bridge<R: Runtime>(
    listener: TcpListener,
    token: String,
    port: u16,
    log: PathBuf,
    app: AppHandle<R>,
) {
    let allowed_origin = format!("http://127.0.0.1:{port}");
    for incoming in listener.incoming() {
        let Ok(mut stream) = incoming else {
            continue;
        };
        let Some((target, origin, body)) = read_http_request(&mut stream) else {
            respond(&mut stream, "400 Bad Request", &allowed_origin);
            continue;
        };
        if origin != allowed_origin {
            respond(&mut stream, "403 Forbidden", &allowed_origin);
            continue;
        }

        if target == format!("/native/notify?token={token}") {
            let Ok(payload) = serde_json::from_slice::<NotificationRequest>(&body) else {
                respond(&mut stream, "400 Bad Request", &allowed_origin);
                continue;
            };
            let _ = app
                .notification()
                .builder()
                .title(payload.title)
                .body(payload.body)
                .show();
            respond(&mut stream, "204 No Content", &allowed_origin);
            continue;
        }

        if target == format!("/native/progress?token={token}") {
            let Ok(payload) = serde_json::from_slice::<ProgressRequest>(&body) else {
                respond(&mut stream, "400 Bad Request", &allowed_origin);
                continue;
            };
            let status = match payload.status.as_str() {
                "normal" => ProgressBarStatus::Normal,
                "indeterminate" => ProgressBarStatus::Indeterminate,
                "paused" => ProgressBarStatus::Paused,
                "error" => ProgressBarStatus::Error,
                _ => ProgressBarStatus::None,
            };
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_progress_bar(ProgressBarState {
                    status: Some(status),
                    progress: payload.progress.map(|value| value.min(100)),
                });
            }
            respond(&mut stream, "204 No Content", &allowed_origin);
            continue;
        }

        if target == format!("/native/open?token={token}") {
            let Some(url) = serde_json::from_slice::<OpenRequest>(&body)
                .ok()
                .and_then(|payload| payload.url.parse::<Url>().ok())
            else {
                respond(&mut stream, "400 Bad Request", &allowed_origin);
                continue;
            };
            open_link(&app, port, &log, url);
            respond(&mut stream, "204 No Content", &allowed_origin);
            continue;
        }

        respond(&mut stream, "404 Not Found", &allowed_origin);
    }
}

fn unused_loopback_port() -> Result<u16, Box<dyn std::error::Error>> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}

/// The backend's port, kept from one launch to the next. The page's origin is
/// `http://127.0.0.1:<port>`, and the browser engine keys `localStorage` by origin: the
/// theme, the language and the folded rail all live there, and a port drawn fresh on every
/// launch meant every launch started over in dark English. So the port that worked last
/// time is written down beside the database and asked for first. Only the first time, or
/// when something else holds it, does the system pick — and that pick is written down in
/// turn, since it is the origin the page's preferences are about to be saved under.
fn backend_port(data_dir: &Path, log: &Path) -> Result<u16, Box<dyn std::error::Error>> {
    let record = data_dir.join("backend-port");
    let remembered = fs::read_to_string(&record)
        .ok()
        .and_then(|text| text.trim().parse::<u16>().ok())
        .filter(|port| *port != 0);
    if let Some(port) = remembered {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
        append_log(
            log,
            &format!("port {port} is taken; the page's saved preferences start over on a new one"),
        );
    }
    let port = unused_loopback_port()?;
    fs::write(&record, port.to_string())?;
    Ok(port)
}

fn append_log(path: &Path, line: &str) {
    if let Ok(mut log) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(log, "{line}");
    }
}

fn backend_executable(resource_dir: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    const EXECUTABLE: &str = "blunderbase-desktop.exe";
    #[cfg(not(target_os = "windows"))]
    const EXECUTABLE: &str = "blunderbase-desktop";

    resource_dir.join("backend").join(EXECUTABLE)
}

fn spawn_backend(
    executable: &Path,
    data_dir: &Path,
    database_path: &Path,
    log: &Path,
    port: u16,
    desktop_token: &str,
) -> Result<Child, Box<dyn std::error::Error>> {
    let stdout = File::options().create(true).append(true).open(log)?;
    let stderr = stdout.try_clone()?;
    let child = Command::new(executable)
        .args(["serve", "--host", "127.0.0.1", "--port", &port.to_string()])
        .env("BLUNDERBASE_DATA_DIR", data_dir)
        .env("BLUNDERBASE_DB_PATH", database_path)
        .env("BLUNDERBASE_RUNTIME_MODE", "desktop")
        .env("BLUNDERBASE_DESKTOP_TOKEN", desktop_token)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()?;
    Ok(child)
}

fn backend_is_ready(port: u16) -> bool {
    let Ok(mut stream) =
        TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(100))
    else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut response = [0_u8; 64];
    matches!(stream.read(&mut response), Ok(read) if String::from_utf8_lossy(&response[..read]).contains(" 200 "))
}

fn is_ours(url: &Url, port: u16) -> bool {
    url.host_str() == Some("127.0.0.1") && url.port() == Some(port)
}

fn open_in_browser<R: Runtime>(app: &AppHandle<R>, log: &Path, url: &Url) {
    if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
        append_log(
            log,
            &format!("could not open {url} in the browser: {error}"),
        );
    }
}

/// A link that leaves the page. A webview has no tabs, so a `target="_blank"` link is a
/// question for the shell, and the page asks it over the bridge (`/native/open`, see the
/// web's `lib/desktop/links.ts`) because on macOS WebKit never put the request to the
/// webview's own new-window handler below. Two answers. A URL on our own backend is the
/// manual, and gets a second window of the app so it can sit beside the game it explains;
/// one manual window, reused, because every (?) after the first would otherwise pile up
/// windows. Anything else is somebody else's site and belongs in the person's browser,
/// where they are signed in to lichess and chess.com. The manual window keeps the same
/// rule for links inside it: a manual page linking out to GitHub goes to the browser, not
/// into the app.
fn open_link<R: Runtime>(app: &AppHandle<R>, port: u16, log: &Path, url: Url) {
    if !is_ours(&url, port) {
        open_in_browser(app, log, &url);
        return;
    }
    if let Some(existing) = app.get_webview_window(MANUAL_WINDOW) {
        let _ = existing.navigate(url);
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return;
    }
    let for_navigation = (app.clone(), log.to_path_buf());
    let for_new_window = (app.clone(), log.to_path_buf());
    let built = WebviewWindowBuilder::new(app, MANUAL_WINDOW, WebviewUrl::External(url))
        .title("Blunderbase Manual")
        .inner_size(1100.0, 820.0)
        .min_inner_size(640.0, 480.0)
        .on_navigation(move |url| {
            if is_ours(url, port) {
                return true;
            }
            open_in_browser(&for_navigation.0, &for_navigation.1, url);
            false
        })
        .on_new_window(move |url, _features| {
            open_link(&for_new_window.0, port, &for_new_window.1, url);
            NewWindowResponse::Deny
        })
        .build();
    if let Err(error) = built {
        append_log(log, &format!("could not open the manual window: {error}"));
    }
}

/// The webview's own answer to a new-window request, for whatever reaches it. The page
/// takes its links over before they get here (`links.ts`), and on macOS this was never
/// called for them anyway; it stays so that a `window.open` from somewhere the page's
/// handler does not cover — an extension, a future library — is not silently dropped.
fn open_requested<R: Runtime>(
    app: &AppHandle<R>,
    port: u16,
    log: &Path,
    url: Url,
) -> NewWindowResponse<R> {
    open_link(app, port, log, url);
    NewWindowResponse::Deny
}

fn navigate<R: Runtime>(window: &WebviewWindow<R>, path: &str) {
    let Ok(mut url) = window.url() else {
        return;
    };
    if !matches!(url.scheme(), "http" | "https") {
        return;
    }
    url.set_path(path);
    url.set_query(None);
    let _ = window.navigate(url);
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let preferences = MenuItemBuilder::with_id("preferences", "Engine Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let palette = MenuItemBuilder::with_id("command-palette", "Command Palette…")
        .accelerator("CmdOrCtrl+K")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Blunderbase")
        .about(Some(
            AboutMetadataBuilder::new()
                .name(Some("Blunderbase"))
                .version(Some(env!("CARGO_PKG_VERSION")))
                .build(),
        ))
        .separator()
        .item(&preferences)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&palette)
        .separator()
        .fullscreen()
        .build()?;
    let go_menu = SubmenuBuilder::new(app, "Go")
        .item(
            &MenuItemBuilder::with_id("go-dashboard", "Dashboard")
                .accelerator("CmdOrCtrl+1")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("go-games", "Games")
                .accelerator("CmdOrCtrl+2")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("go-explorer", "Explorer")
                .accelerator("CmdOrCtrl+3")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("go-notes", "Notes")
                .accelerator("CmdOrCtrl+4")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("go-stats", "Stats")
                .accelerator("CmdOrCtrl+5")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("go-import", "Import")
                .accelerator("CmdOrCtrl+Shift+I")
                .build(app)?,
        )
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &view_menu, &go_menu, &window_menu])
        .build()
}

fn handle_menu<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    match id {
        "preferences" => navigate(&window, "/engines"),
        "command-palette" => {
            let _ = window.eval(
                "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: navigator.platform.includes('Win'), bubbles: true }))",
            );
        }
        "go-dashboard" => navigate(&window, "/"),
        "go-games" => navigate(&window, "/games"),
        "go-explorer" => navigate(&window, "/explorer"),
        "go-notes" => navigate(&window, "/notes"),
        "go-stats" => navigate(&window, "/stats"),
        "go-import" => navigate(&window, "/import"),
        _ => {}
    }
}

fn stop_backend<R: Runtime>(handle: &AppHandle<R>) {
    if let Some(mut child) = handle.state::<BackendChild>().0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .menu(build_menu)
        .on_menu_event(|app, event| handle_menu(app, event.id().as_ref()))
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let resource_dir = app.path().resource_dir()?;
            fs::create_dir_all(&data_dir)?;
            let log = data_dir.join("desktop.log");
            let port = backend_port(&data_dir, &log)?;
            let feedback_listener = TcpListener::bind(("127.0.0.1", 0))?;
            let feedback_port = feedback_listener.local_addr()?.port();
            let feedback_token = feedback_token();
            let database_path = data_dir.join("blunderbase.db");
            let executable = backend_executable(&resource_dir);

            append_log(&log, "starting bundled backend");
            let child = spawn_backend(
                &executable,
                &data_dir,
                &database_path,
                &log,
                port,
                &feedback_token,
            )?;
            app.manage(BackendChild(Mutex::new(Some(child))));

            let feedback_app = app.handle().clone();
            let feedback_token_for_server = feedback_token.clone();
            let feedback_log = log.clone();
            std::thread::spawn(move || {
                run_feedback_bridge(
                    feedback_listener,
                    feedback_token_for_server,
                    port,
                    feedback_log,
                    feedback_app,
                );
            });

            // The window is built here rather than by tauri from the config (`"create":
            // false` in tauri.conf.json), because a new-window handler can only be
            // attached to a builder, and without one every `target="_blank"` link in the
            // app is silently dropped.
            let main_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .cloned()
                .ok_or("desktop window is not configured")?;
            let links = (app.handle().clone(), log.clone());
            let window = WebviewWindowBuilder::from_config(app.handle(), &main_config)?
                .on_new_window(move |url, _features| open_requested(&links.0, port, &links.1, url))
                .build()?;
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                for _ in 0..BACKEND_READY_ATTEMPTS {
                    if backend_is_ready(port) {
                        let url = format!(
                            "http://127.0.0.1:{port}/#bb-native={feedback_port}:{feedback_token}"
                        )
                            .parse::<Url>()
                            .expect("loopback URL is valid");
                        let _ = window.navigate(url);
                        let _ = window.show();
                        let _ = window.set_focus();
                        return;
                    }
                    std::thread::sleep(BACKEND_READY_DELAY);
                }

                append_log(&log, "backend did not become healthy within 24 seconds");
                let _ = window.show();
                let _ = window.eval(
                    "document.getElementById('status').textContent = 'Blunderbase could not start. Open the app again; if the problem continues, check desktop.log in the app data folder.'",
                );
                app_handle
                    .dialog()
                    .message("Blunderbase could not start. Please quit and open it again.")
                    .title("Blunderbase")
                    .kind(MessageDialogKind::Error)
                    .show(|_| {});
            });

            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to build Blunderbase desktop application");

    app.run(|handle, event| match event {
        RunEvent::Exit | RunEvent::ExitRequested { .. } => stop_backend(handle),
        #[cfg(target_os = "macos")]
        RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            api.prevent_close();
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        _ => {}
    });
}
