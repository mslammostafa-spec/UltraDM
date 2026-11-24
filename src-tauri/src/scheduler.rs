//! مجدول التحميلات: نوافذ زمنية تبدأ وتوقف الطابور تلقائيًا (مباشر وتورنت).

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
pub fn in_window(start: &str, end: &str, now: u32, weekday: u32) -> bool {
    let (Some(s), Some(e)) = (minutes_of(start), minutes_of(end)) else {
        return false;
    };
    let day_ok = match start_kind(end, start) {
        _ => {
            let _ = weekday;
            true
        }
    };
    let _ = day_ok;
    if s == e {
        return false;
    }
    if s < e {
        now >= s && now < e
    } else {
        now >= s || now < e
    }
}

fn start_kind(_end: &str, _start: &str) -> () {}

/// تطبيق تصنيف الأيام: 6=سبت، 7=أحد (احتساب أوروبي-عربي) أو يومي.
pub fn day_matches(kind: &str, weekday: u32) -> bool {
    match kind {
        "weekdays" => (1..=5).contains(&weekday),
        "weekend" => matches!(weekday, 5 | 6),
        _ => true,
    }
}

/// تحديث قواعد الجدولة من الواجهة.
#[tauri::command]
pub fn scheduler_set_rules(state: State<'_, std::sync::Arc<Scheduler>>, rules: Vec<ScheduleRule>) -> Result<SchedulerStateInfo, String> {
    // تحقق من صحة التوقيتات قبل الحفظ.
    for r in &rules {
        if minutes_of(&r.start).is_none() || minutes_of(&r.end).is_none() {
            return Err(format!("توقيت غير صالح: {} ← {}", r.start, r.end));
        }
    }
    *state.rules.lock().unwrap() = rules.clone();
    Ok(SchedulerStateInfo { active: false, rules })
}

/// حلقة المجدول: كل 30 ثانية تفحص النوافذ وتصدر الحالة.
pub fn spawn_scheduler(app: AppHandle, sched: std::sync::Arc<Scheduler>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            let rules: Vec<ScheduleRule> = sched.rules.lock().unwrap().clone();
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
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs() % 86_400;
    (secs / 60) as u32
}

fn chrono_now_weekday() -> u32 {
    // الأيام من الأحد=0 .. السبت=6 (UTC مبسّط)
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    ((now.as_secs() / 86_400) % 7) as u32
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
