//! التسجيل في ويندوز كمستقبل افتراضي لروابط Magnet وملفات .torrent.

#[tauri::command]
pub fn register_torrent_handler() -> Result<(), String> {
    register_impl()
}

#[cfg(target_os = "windows")]
fn register_impl() -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let cmd = format!("\"{}\" \"%1\"", exe.display());
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    // بروتوكول magnet:
    let (key, _) = hkcu
        .create_subkey("Software\\Classes\\magnet")
        .map_err(|e| e.to_string())?;
    key.set_value("", &"URL:Magnet Protocol").map_err(|e| e.to_string())?;
    key.set_value("URL Protocol", &"").map_err(|e| e.to_string())?;
    let (open, _) = hkcu
        .create_subkey("Software\\Classes\\magnet\\shell\\open\\command")
        .map_err(|e| e.to_string())?;
    open.set_value("", &cmd.as_str()).map_err(|e| e.to_string())?;

    // ملفات .torrent عبر ProgID خاص: مفاتيح Registry تبقى UltraDM.torrent
    // حتى لا تنقطع ربطات الملفات لدى من ثبّت نسخة سابقة من البرنامج.
    let (prog, _) = hkcu
        .create_subkey("Software\\Classes\\UltraDM.torrent")
        .map_err(|e| e.to_string())?;
    prog.set_value("", &"الفتح Torrent").map_err(|e| e.to_string())?;
    let (open2, _) = hkcu
        .create_subkey("Software\\Classes\\UltraDM.torrent\\shell\\open\\command")
        .map_err(|e| e.to_string())?;
    open2.set_value("", &cmd.as_str()).map_err(|e| e.to_string())?;
    let (ext, _) = hkcu
        .create_subkey("Software\\Classes\\.torrent")
        .map_err(|e| e.to_string())?;
    ext.set_value("", &"UltraDM.torrent").map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn register_impl() -> Result<(), String> {
    Err("التسجيل كمستقبل افتراضي متاح على ويندوز فقط".into())
}

/// التسجيل التلقائي عند بدء التشغيل عبر tauri-plugin-autostart (مفتاح Run
/// مع الراية --ultradm-silent لإقلاع صامت مؤجَّل إلى الشريط).
#[tauri::command]
pub fn register_autostart(app: tauri::AppHandle, enable: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt as _;
    let manager = app.autolaunch();
    if enable {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn registration_is_windows_only() {
        // على لينكس (بيئة الاختبار) يجب أن يفشل برسالة واضحة لا بانهيار.
        assert!(super::register_impl().is_err() || cfg!(target_os = "windows"));
    }
}
