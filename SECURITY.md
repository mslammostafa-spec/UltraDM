# Security Policy / سياسة الأمان

الفتح (AlFath) is an open-source project maintained by a single developer. Taking security reports seriously is part of keeping it trustworthy.

برنامج الفتح مشروع مفتوح المصدر يُطوَّر بواسطة مطوّر واحد، والإبلاغ المسؤول عن الثغرات جزء من الحفاظ على ثقة المشروع.

## Supported versions / الإصدارات المدعومة

| Version | Supported |
| ------- | --------- |
| 1.0.x   | ✅ |
| < 1.0   | ❌ |

Security fixes are released as new patch versions on the [Releases](https://github.com/mslammostafa-spec/UltraDM/releases) page.

## How to report a vulnerability / كيفية الإبلاغ عن ثغرة

**Please do not open a public GitHub issue for security problems.**

يرجى عدم فتح Issue عام لأي مشكلة أمنية.

Preferred channels:

1. **GitHub private vulnerability reporting** (fastest): open the repository → **Security** tab → **Report a vulnerability**, and fill in the private form.
2. If that is not possible, contact the maintainer through a private channel listed on the repository owner's GitHub profile.

Please include:

- A description of the issue and its security impact.
- Step-by-step instructions or a proof of concept to reproduce it.
- The affected version (from `src-tauri/tauri.conf.json`) and your Windows version.
- Any logs or screenshots (redact personal data).

## What to expect / ما يمكن توقعه

- **Acknowledgement** within 72 hours.
- An initial assessment and, when applicable, a fix or mitigation — target: within 90 days for high-severity issues.
- You will be credited in the release notes if you wish, unless you prefer to stay anonymous.

## Scope / نطاق الإبلاغ

In scope:

- The الفتح (AlFath) Windows application (Tauri/Rust backend and its IPC commands).
- The Native Messaging host and its registry configuration written by the installer.
- The bundled browser extension (`browser-extension/`), including permissions and message handling.
- The installer hooks (`src-tauri/installer-hooks.nsh`), e.g. registry keys written during install/uninstall.
- The build/release workflow (`.github/workflows/release.yml`) — e.g. supply-chain issues in what it publishes.

Out of scope:

- SmartScreen / antivirus warnings caused by the lack of a code-signing certificate.
- Self-XSS or social-engineering of users.
- Vulnerabilities in third-party dependencies that only require upgrading; still report them and they will be handled promptly.

## Safe handling / التعامل الآمن

Please give the maintainer reasonable time to fix the issue before any public disclosure, and avoid testing against systems you do not own.
