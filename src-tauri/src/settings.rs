use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

/// قراءة الإعدادات المحفوظة (نص JSON خام)؛ يعيد null عند عدم وجود ملف.
#[tauri::command]
pub fn load_settings(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = settings_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(_) => Ok(None),
    }
}

/// حفظ الإعدادات في settings.json داخل مجلد إعدادات التطبيق.
#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // تحقق أن المحتوى JSON صالح قبل كتابته
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_json() {
        // بدون AppHandle لا يمكن استدعاء save_settings مباشرة؛ نتحقق من صحة التحقق
        let bad = "{not json";
        assert!(serde_json::from_str::<serde_json::Value>(bad).is_err());
        let good = r#"{"theme":"glass-emerald-cyan"}"#;
        assert!(serde_json::from_str::<serde_json::Value>(good).is_ok());
    }
}
