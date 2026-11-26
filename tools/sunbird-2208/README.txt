Ultracord for Discord 2208
==========================

A build of Sunbird, the plugin runtime for Discord Phoenix, with the fixes
the Windows build 2208 needs:
- message notifications work again (sound and Windows notification)
- buttons, text fields and dialogs from plugins are clickable
- plugins can add their own tabs in Settings, and show banners in Discord,
  with a picture like an avatar or a server icon

How to use
1. Quit Discord: right click its icon in the taskbar tray, then Quit.
2. Extract this folder anywhere you like, for example in Documents.
3. Double click "Launch Discord.bat".
   If Windows shows "Windows protected your PC", click "More info", then
   "Run anyway": these files are not signed.

Always start Discord with "Launch Discord.bat". Discord's own shortcut, and
the official Sunbird launcher, start it without these fixes.

Updates
New versions come as a new zip, on
https://github.com/acasamit/ultracord/releases/latest
Ignore the "Sunbird update available" banner: it is about the official
Sunbird, which does not have the 2208 fixes. Plugins still update on their
own.

Uninstall
Delete this folder. Discord's own files are never modified.

License
This is a modified version of Sunbird (https://github.com/sunbird-tools/sunbird),
distributed under the European Union Public Licence 1.2, in
LICENSE-EUPL-1.2.txt. The source code of this build is
https://github.com/acasamit/sunbird/tree/{{SHA}}
