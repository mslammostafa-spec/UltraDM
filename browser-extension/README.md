# إضافة UltraDM للمتصفح (Manifest V3)

إضافة تلتقط روابط التحميل والبث وترسلها فورًا إلى برنامج UltraDM عبر WebSocket محلي (`ws://127.0.0.1:24580/ultradm`) مع Native Messaging كبديل.

## المتصفحات المدعومة
Chrome، Edge، Brave، Opera (كل محركات Chromium MV3). ملف `browser_specific_settings` يسمح أيضًا بتحميلها في Firefox (مع قيود service worker).

## التثبيت (وضع المطوّر)
1. افتح `chrome://extensions` (أو `edge://extensions`).
2. فعّل «وضع المطوّر» ثم «تحميل إضافة غير مضغوطة» واختر مجلد `browser-extension/`.
3. شغّل برنامج UltraDM — سترى شارة الاتصال خضراء في البوب-أب.

## الصلاحيات ولماذا
| صلاحية | الغرض |
|---|---|
| `nativeMessaging` | البديل عالي الموثوقية لإرسال روابط Magnet إلى UltraDM (لا يمكن إرسالها عبر HTTP). |
| `storage` | حفظ الثيم المزامَن من البرنامج وحالة التشغيل محليًا. |
| `cookies` | تمرير الكوكيز مع كل رابط يُلتقط حتى تُنزّل الملفات المصادقة من UltraDM. |
| `webRequest` | مراقبة عناوين الشبكة لاصطياد البث (M3U8/MPD/MP4) في الخلفية. |
| `host_permissions` (http/https) | قراءة الكوكيز وإرفاق الـReferer لأي موقع يُلتقط منه رابط. |
| `notifications` | إشعار نجاح إرسال الالتقاط إلى البرنامج. |

## البنية
- `background.js` — Service Worker: قناة WebSocket + Native Messaging + تمرير الكوكيز/UA.
- `content/capture.js` — صائد الروابط: PerformanceObserver + اعتراض XHR/fetch + مسح عناصر الوسائط.
- `content/floating.js` + `floating.css` — الزر العائم فوق المشغلات بألوان ثيم UltraDM.
- `popup/` — حالة الاتصال، تشغيل/إيقاف الاصطياد، وقائمة وسائط الصفحة.

## الربط التلقائي (ويندوز)
زر «تثبيت الربط تلقائيًا» في إعدادات UltraDM يكتب مفاتيح `HKCU\Software\<Browser>\NativeMessagingHosts\com.ultradm.bridge` لكل متصفح مثبت، ويعرض حالة الربط لكل واحد.

## الفحص
```
npx web-ext lint        # خطأ واحد متوقع فقط: service worker بلا بديل Firefox (الإضافة لمحركات Chromium)
```
