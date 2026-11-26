//! مجدول التحميلات: نوافذ زمنية تبدأ وتوقف الطابور تلقائيًا (مباشر وتورنت).

use crate::settings;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ScheduleRule {
    pub id: u64,
    /// "HH:MM"
    pub start: String,
    /// "HH:MM"
    pub end: String,
    /// daily | weekdays | weekend
    pub kind: String,
}

#[derive(Serialize, Clone)]
pub struct SchedulerStateInfo {
    pub active: bool,
    pub rules: Vec<ScheduleRule>,
}

pub struct Scheduler {
    pub rules: Mutex<Vec<ScheduleRule>>,
}

fn minutes_of(t: &str) -> Option<u32> {
    let (h, m) = t.split_once(':')?;
    let h: u32 = h.parse().ok()?;
    let m: u32 = m.parse().ok()?;
    if h > 23 || m > 59 {
        return None;
    }
    Some(h * 60 + m)
}

/// هل "now" داخل النافذة [start, end)؟ يدعم عبور منتصف الليل.
#[must_use]
pub fn in_window(start: &str, end: &str, now: u32, weekday: u32) -> bool {
    let (Some(s), Some(e)) = (minutes_of(start), minutes_of(end)) else {
        return false;
    };
    // تصنيف الأيام (يومي/أيام عمل) يُطبَّق في من يستدعي عبر day_matches.
    let _ = weekday;
    if s == e {
        return false;
    }
    if s < e {
        now >= s && now < e
    } else {
        now >= s || now < e
    }
}

/// تطبيق تصنيف الأيام: 6=سبت، 7=أحد (احتساب أوروبي-عربي) أو يومي.
#[must_use]
pub fn day_matches(kind: &str, weekday: u32) -> bool {
    match kind {
        "weekdays" => (1..=5).contains(&weekday),
        "weekend" => matches!(weekday, 5 | 6),
        _ => true,
    }
}

/// تحديث قواعد الجدولة من الواجهة (وتُحفَظ في settings.json لتبقى بعد إعادة التشغيل).
#[tauri::command]
pub fn scheduler_set_rules(app: tauri::AppHandle, state: State<'_, std::sync::Arc<Scheduler>>, rules: Vec<ScheduleRule>) -> Result<SchedulerStateInfo, String> {
    // تحقق من صحة التوقيتات قبل الحفظ.
    for r in &rules {
        if minutes_of(&r.start).is_none() || minutes_of(&r.end).is_none() {
            return Err(format!("توقيت غير صالح: {} ← {}", r.start, r.end));
        }
    }
    save_rules_to_disk(&app, &rules);
    state
        .rules
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone_from(&rules);
    Ok(SchedulerStateInfo { active: false, rules })
}

const SCHED_KEY: &str = "schedule_rules";

/// قراءة قواعد الجدولة المحفوظة من settings.json (قائمة فارغة إن لم توجد).
#[must_use]
pub fn load_rules_from_disk(app: &tauri::AppHandle) -> Vec<ScheduleRule> {
    let raw = settings::load_settings(app.clone()).ok().flatten();
    let Some(text) = raw else { return Vec::new() };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { return Vec::new() };
    serde_json::from_value(v.get(SCHED_KEY).cloned().unwrap_or(serde_json::Value::Null)).unwrap_or_default()
}

/// كتابة قواعد الجدولة داخل settings.json مع الإبقاء على بقية المفاتيح.
pub fn save_rules_to_disk(app: &tauri::AppHandle, rules: &[ScheduleRule]) {
    let mut root = settings::load_settings(app.clone())
        .ok()
        .flatten()
        .and_then(|t| serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&t).ok())
        .unwrap_or_default();
    root.insert(
        SCHED_KEY.into(),
        serde_json::to_value(rules).unwrap_or(serde_json::Value::Null),
    );
    if let Ok(text) = serde_json::to_string(&root) {
        let _ = settings::save_settings(app.clone(), text);
    }
}

/// حلقة المجدول: كل 30 ثانية تفحص النوافذ وتصدر الحالة.
pub fn spawn_scheduler(app: AppHandle, sched: std::sync::Arc<Scheduler>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            let rules: Vec<ScheduleRule> = sched.rules.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
            if rules.is_empty() {
                continue;
            }
            let now = chrono_now_minutes();
            let weekday = chrono_now_weekday();
            let active = rules
                .iter()
                .any(|r| in_window(&r.start, &r.end, now, weekday) && day_matches(&r.kind, weekday));
            let _ = Emitter::emit(&app, "scheduler://state", &SchedulerStateInfo { active, rules });
        }
    });
}

fn chrono_now_minutes() -> u32 {
    // التوقيت المحلي: جداول "23:00 إلى 08:00" يجب أن تعمل بتوقيت المستخدم
    // لا UTC (كان الانحراف بقدر فرق المنطقة الزمنية).
    use chrono::Timelike;
    let now = chrono::Local::now();
    now.hour() * 60 + now.minute()
}

fn chrono_now_weekday() -> u32 {
    // الاثنين=1 .. الأحد=7 (يتطابق مع day_matches) بتوقيت المستخدم المحلي.
    use chrono::Datelike;
    chrono::Local::now().weekday().number_from_monday()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_crosses_midnight() {
        assert!(in_window("23:00", "08:00", 23 * 60 + 30, 1));
        assert!(in_window("23:00", "08:00", 7 * 60, 1));
        assert!(!in_window("23:00", "08:00", 12 * 60, 1));
        assert!(in_window("02:00", "08:00", 2 * 60, 1));
        assert!(!in_window("02:00", "08:00", 9 * 60, 1));
        assert!(!in_window("05:00", "05:00", 5 * 60, 1));
    }

    #[test]
    fn day_filter() {
        assert!(day_matches("daily", 3));
        assert!(!day_matches("weekdays", 6));
        assert!(day_matches("weekend", 5));
        assert!(day_matches("weekend", 6));
    }
}
