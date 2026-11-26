use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;
use tauri::Manager;

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

/// ذاكرة مؤقتة للثيم: كانت settings.json تُقرأ من القرص مع كل اتصال
/// WebSocket جديد — الآن تُحدَّث عند الكتابة فقط.
static THEME_CACHE: RwLock<Option<String>> = RwLock::new(None);

/// الثيم الحالي: من الذاكرة المؤقتة، وإلا من settings.json (وتُعبَّئ الذاكرة).
pub fn cached_theme(app: &tauri::AppHandle) -> String {
    if let Ok(t) = THEME_CACHE.read() {
        if let Some(t) = t.as_deref() {
            return t.to_owned();
        }
    }
    let theme = load_settings(app.clone())
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|v| v.get("theme").and_then(|t| t.as_str()).map(String::from))
        .unwrap_or_else(|| "glass-emerald-cyan".into());
    if let Ok(mut t) = THEME_CACHE.write() {
        *t = Some(theme.clone());
    }
    theme
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
    // تحديث ذاكرة الثيم فورًا حتى لا يقرأ خادم الإضافة قيمة قديمة.
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
        if let Some(t) = v.get("theme").and_then(|t| t.as_str()) {
            if let Ok(mut c) = THEME_CACHE.write() {
                *c = Some(t.to_owned());
            }
        }
    }
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    

    #[test]
    fn rejects_invalid_json() {
        // بدون AppHandle لا يمكن استدعاء save_settings مباشرة؛ نتحقق من صحة التحقق
        let bad = "{not json";
        assert!(serde_json::from_str::<serde_json::Value>(bad).is_err());
        let good = r#"{"theme":"glass-emerald-cyan"}"#;
        assert!(serde_json::from_str::<serde_json::Value>(good).is_ok());
    }
}
