; خطّاف مثبّت NSIS لبرنامج UltraDM (Tauri 2: bundle > windows > nsis > installerHooks)
; يقوم عند التثبيت بـ:
;  1) كتابة ملف manifest الخاص بـ Native Messaging (المضيف com.ultradm.bridge) داخل مجلد التثبيت.
;  2) تسجيل مفاتيح HKCU\Software\<Browser>\NativeMessagingHosts\com.ultradm.bridge لكل متصفح.
;  3) تثبيت إضافة المتصفح تلقائيًا عبر ExtensionInstallForcelist لـ Chrome وEdge.
;    (تعمل المفاتيح فعليًا بعد نشر الإضافة في المتجرين؛ المعرّف ثابت بفضل حقل "key" في manifest.json)

!include "StrFunc.nsh"
${Using:StrFunc} StrRep

!macro NSIS_HOOK_PREINSTALL
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; تحويل فواصل المسار لصيغة JSON صالحة (\\ بدلًا من \)
  ${StrRep} $R0 "$INSTDIR" "\" "\\"

  ; ملف manifest الخاص بـ Native Messaging داخل مجلد التثبيت
  FileOpen $R1 "$INSTDIR\browser-extension\native-host.json" w
  FileWrite $R1 '{"name": "com.ultradm.bridge",$\n'
  FileWrite $R1 ' "description": "UltraDM Native Messaging Bridge",$\n'
  FileWrite $R1 ' "path": "$R0\UltraDM.exe",$\n'
  FileWrite $R1 ' "type": "stdio",$\n'
  FileWrite $R1 ' "allowed_origins": [$\n'
  FileWrite $R1 '   "chrome-extension://kpjldkbninldcnhfjnbpbenejifihobc/"$\n'
  FileWrite $R1 ' ]$\n'
  FileWrite $R1 '}$\n'
  FileClose $R1

  ; تسجيل المضيف لكل متصفح (HKCU لأن التثبيت بوضع currentUser)
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\com.ultradm.bridge" "" "$INSTDIR\browser-extension\native-host.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.ultradm.bridge" "" "$INSTDIR\browser-extension\native-host.json"
  WriteRegStr HKCU "Software\BraveSoftware\Brave\NativeMessagingHosts\com.ultradm.bridge" "" "$INSTDIR\browser-extension\native-host.json"
  WriteRegStr HKCU "Software\Opera Software\NativeMessagingHosts\com.ultradm.bridge" "" "$INSTDIR\browser-extension\native-host.json"

  ; تثبيت الإضافة قسرًا في Chrome وEdge (ExtensionInstallForcelist)
  ; صيغة القيمة: <extension_id>;<update_url> — التخزينان المذكوران هما المصدران الرسميان
  WriteRegStr HKCU "Software\Policies\Google\Chrome\ExtensionInstallForcelist" "1" "kpjldkbninldcnhfjnbpbenejifihobc;https://clients2.google.com/service/update2/crx"
  WriteRegStr HKCU "Software\Policies\Microsoft\Edge\ExtensionInstallForcelist" "1" "kpjldkbninldcnhfjnbpbenejifihobc;https://edge.microsoft.com/extensionwebstorebase/v1/crx"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; إزالة مفاتيح تسجيل المضيف
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.ultradm.bridge"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.ultradm.bridge"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave\NativeMessagingHosts\com.ultradm.bridge"
  DeleteRegKey HKCU "Software\Opera Software\NativeMessagingHosts\com.ultradm.bridge"

  ; إزالة قيم الإجبار التي كتبها هذا المثبّت فقط (بدون حذف مفاتيح سياسات لا تخصنا)
  DeleteRegValue HKCU "Software\Policies\Google\Chrome\ExtensionInstallForcelist" "1"
  DeleteRegValue HKCU "Software\Policies\Microsoft\Edge\ExtensionInstallForcelist" "1"
!macroend
