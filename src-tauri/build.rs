fn main() {
    // El triple objetivo se necesita en tiempo de compilación para localizar el
    // sidecar de Go en desarrollo, donde Tauri lo espera con el sufijo del
    // triple (binaries/saveme-aarch64-apple-darwin).
    let target = std::env::var("TARGET").unwrap_or_default();
    println!("cargo:rustc-env=SAVEME_TARGET_TRIPLE={target}");
    tauri_build::build()
}
