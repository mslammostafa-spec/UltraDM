; خطّاف مثبّت NSIS لبرنامج UltraDM (Tauri 2: bundle > windows > nsis > installerHooks)
; يقوم عند التثبيت بـ:
;  1) كتابة ملف manifest الخاص بـ Native Messaging (المضيف com.ultradm.bridge) داخل مجلد التثبيت.
;  2) اكتشاف المتصفحات المثبتة (Chrome / Edge / Brave / Opera) عبر مفاتيح التسجيل وكتابة مساراتها في browser-paths.txt.
;  3) تسجيل مفاتيح HKCU\Software\<Browser>\NativeMessagingHosts\com.ultradm.bridge لكل متصفح.
;  4) تثبيت إضافة المتصفح تلقائيًا عبر ExtensionInstallForcelist لـ Chrome وEdge وBrave.
;    (تعمل المفاتيح فعليًا بعد نشر الإضافة في المتاجر؛ المعرّف ثابت بفضل حقل "key" في manifest.json)

!include "StrFunc.nsh"
${Using:StrFunc} StrRep

!macro NSIS_HOOK_PREINSTALL
!macroend

; يقرأ مسار تنفيذ المتصفح من "App Paths" أو مفتاح إزالة التثبيت ويعيده في المتغير المتحول
!macro _DetectBrowser _outVar _appExeName _uninstallKey
  ReadRegStr ${_outVar} HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\${_appExeName}" ""
  ${If} ${_outVar} == ""
    ReadRegStr ${_outVar} HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\${_appExeName}" ""
  ${EndIf}
  ${If} ${_outVar} == ""
    ClearErrors
    ReadRegStr ${_outVar} HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${_uninstallKey}" "InstallLocation"
    ${If} ${Errors}
      StrCpy ${_outVar} ""
    ${EndIf}
    ${If} ${_outVar} != ""
      StrCpy ${_outVar} "${_outVar}\${_appExeName}"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; تحويل فواصل المسار لصيغة JSON صالحة (\\ بدلًا من \)
  ${StrRep} $R0 "$INSTDIR" "\" "\\"

  ; ملف manifest الخاص بـ Native Messaging داخل مجلد التثبيت
  FileOpen $R1 "$INSTDIR\browser-extension\native-host.json" w
  FileWrite $R1 '{"name": "com.ultradm.bridge",$\n'
  FileWrite $R1 ' "description": "UltraDM Native Messaging Bridge",$\n'
  FileWrite $R1 ' "path": "$R0\\UltraDM.exe",$\n'
  FileWrite $R1 ' "args": ["--native-host"],$\n'
  FileWrite $R1 ' "type": "stdio",$\n'
  FileWrite $R1 ' "allowed_origins": [$\n'
  FileWrite $R1 '   "chrome-extension://kpjldkbninldcnhfjnbpbenejifihobc/"$\n'
  FileWrite $R1 ' ]$\n'
  FileWrite $R1 '}$\n'
  FileClose $R1

  ; اكتشاف المتصفحات المثبتة (مسارات التنفيذ) وتسجيلها في browser-paths.txt
  !insertmacro _DetectBrowser $R2 "chrome.exe"  "Google Chrome"
  !insertmacro _DetectBrowser $R3 "msedge.exe"  "Microsoft Edge"
  !insertmacro _DetectBrowser $R4 "brave.exe"   "BraveBrowser"
  !insertmacro _DetectBrowser $R5 "opera.exe"   "Opera Stable"
  FileOpen $R1 "$INSTDIR\browser-paths.txt" w
  FileWrite $R1 "Chrome=$R2$\n"
  FileWrite $R1 "Edge=$R3$\n"
  FileWrite $R1 "Brave=$R4$\n"
  FileWrite $R1 "Opera=$R5$\n"
  FileClose $R1

  ; تسجيل المضيف لكل متصفح (HKCU لأن التثبيت بوضع currentUser)
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\com.ultradm.bridge" "" "$INSTDIR\browser-extension\native-host.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.ultradm.bridge" "" "$INSTDIR\browser-extension\native-host.json"
  WriteRegStr HKCU "Software\BraveSoftware\Brave\NativeMessagingHosts\com.ultradm.bridge" "" "$INSTDIR\browser-extension\native-host.json"
  WriteRegStr HKCU "Software\Opera Software\NativeMessagingHosts\com.ultradm.bridge" "" "$INSTDIR\browser-extension\native-host.json"

  ; تثبيت الإضافة قسرًا (ExtensionInstallForcelist)
  ; صيغة القيمة: <extension_id>;<update_url> — المتاجر الرسمية
  ; Brave مبني على Chromium ويقرأ سياسات كروم من Software\Policies\Google\Chrome
  ; وكذلك سياساته الخاصة من Software\Policies\BraveSoftware\Brave — نكتب كليهما
  WriteRegStr HKCU "Software\Policies\Google\Chrome\ExtensionInstallForcelist" "1" "kpjldkbninldcnhfjnbpbenejifihobc;https://clients2.google.com/service/update2/crx"
  WriteRegStr HKCU "Software\Policies\Microsoft\Edge\ExtensionInstallForcelist" "1" "kpjldkbninldcnhfjnbpbenejifihobc;https://edge.microsoft.com/extensionwebstorebase/v1/crx"
  WriteRegStr HKCU "Software\Policies\BraveSoftware\Brave\ExtensionInstallForcelist" "1" "kpjldkbninldcnhfjnbpbenejifihobc;https://clients2.google.com/service/update2/crx"
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
  DeleteRegValue HKCU "Software\Policies\BraveSoftware\Brave\ExtensionInstallForcelist" "1"
!macroend
