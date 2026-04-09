use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Launch the Express server as a Tauri sidecar
            let sidecar = app.shell()
                .sidecar("licensevault-server")
                .expect("failed to create sidecar command");

            let (_rx, child) = sidecar
                .spawn()
                .expect("Failed to spawn server sidecar");

            // Store the child handle so the server stays alive while the app runs
            // Tauri automatically kills sidecars on app exit
            app.manage(child);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
