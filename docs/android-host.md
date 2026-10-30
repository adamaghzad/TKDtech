# TKD Scoring Android host

## Status and release gate

The Android host is implemented as a native application containing the same production Next.js, Express, WebSocket, licensing, and SQLite server used by the desktop product. It does not require Termux, a laptop, a second server, or an Internet connection for local scoring.

The following checks have passed on the build host:

- Strict TypeScript, lint, migration validation, and the complete **195/195** software tests.
- The exact staged Android server payload: **25/25 Chromium scenarios**.
- Debug APK compilation with the embedded `libnode.so` and JNI bridge.

These are not physical-device results. A debug-signed **validation prerelease** is available from the product website for on-device testing only. Android hotspot/router connectivity, battery/background policy, process restoration, backup/restore on a phone, and tournament-venue reliability must be validated before a production-signed APK replaces that validation download. Windows desktop releases remain independent and unchanged.

## Runtime layout

- `android/app/src/main/cpp/tkd-node.cpp`: JNI entry into the pinned nodejs-mobile runtime.
- `android/app/src/main/java/com/tkdtech/scoring/HostService.java`: foreground service, private configuration, wake/Wi-Fi locks, lifecycle, and authenticated loopback shutdown.
- `android/app/src/main/java/com/tkdtech/scoring/MainActivity.java`: operator WebView, local downloads/file pickers, Public TV windows, network help, and backup actions.
- `scripts/prepare-android.mjs`: local-mode production build, production-only dependency staging, native-addon/secret audit, and a single ZIP runtime asset.
- Tournament SQLite data and license files are under the app's private `files/data` and `files/license` directories, outside the versioned runtime extraction directory.

The universal phone package includes both `arm64-v8a` and `armeabi-v7a` for 64-bit and 32-bit ARM devices running Android 7.0 (API 24) or newer. An optional `x86_64` build remains available for emulator testing. The app has no hardcoded venue IP address.

## Operator networking

### Router Wi-Fi

Connect the Android host and judge/referee/display devices to the same router. Internet access is not required. Disable client/AP isolation on the router if devices cannot reach one another.

### Android hotspot

Enable the phone's hotspot and connect the other devices directly to that hotspot. Mobile data is not needed for local scoring. Router mode and hotspot mode are alternatives; do not require both at once. Hotspot behavior and simultaneous Wi-Fi sharing vary by phone model.

Use **HOST → Judge network / hotspot** to see the addresses currently reported by Android. Generate a new pairing QR after changing networks. Never use `127.0.0.1` or `localhost` on a separate judge device.

Keep the host notification visible while scoring. If the phone manufacturer offers battery-optimization controls, exempt TKD Scoring and test the exact phone with the screen off and the app backgrounded before relying on it at a venue.

## Backup and restore

1. Open **HOST → Stop host** and wait for the stopped state. Active timers are paused and persisted for operator confirmation.
2. Choose **HOST → Backup data (host stopped)** and select a destination in the Android file picker.
3. Keep the resulting ZIP private. It contains tournament data and the license/installation folder, not the runtime or control token.
4. To restore, stop the host, choose **HOST → Restore data (host stopped)**, and select the ZIP. The app validates the archive and stages the replacement rather than overwriting a live database.
5. Start the host and verify the tournament, license, recovered timer, and a test scoring flow before using it operationally.

Android uninstall normally removes private app data. A license remains device/installation-bound; restoring its file on a different phone can require a support-approved license transfer. Backup/restore still needs an on-device validation pass.

## Build prerequisites

The build uses Node 22 for `node:sqlite` tests, JDK 21, Android SDK 35, NDK 27.2.12479018, CMake 3.31.6, and Gradle 8.11.1. The pinned nodejs-mobile runtime is downloaded and SHA-256 checked by the prepare script. No production signing key is stored in the repository.

From the repository root on the build host:

```bash
export PATH=/path/to/node-v22.16.0-linux-x64/bin:$PATH
export ANDROID_DOWNLOAD_CACHE=/path/to/tkd-android-downloads
node scripts/prepare-android.mjs
```

Then build a debug APK for one ABI:

```bash
cd android
export ANDROID_HOME=/path/to/android-sdk
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME=/path/to/jdk-21
./gradlew assembleDebug -PabiFilters=x86_64 --max-workers=1 --no-daemon
```

Use `-PabiFilters=arm64-v8a` for a 64-bit-only phone package, or omit that property to build the universal ARM package (`arm64-v8a` and `armeabi-v7a`). Use `-PabiFilters=x86_64` only for emulator testing.

## Signing and publication

Only after the device validation checklist passes should a release build be signed with the protected production keystore. Verify the APK with `apksigner verify`, generate a SHA-256 checksum, and record the exact source revision and ABI set. Then replace the validation download with the production APK, checksum, and these installation/backup notes beside the existing Windows package on the independent product website. Do not replace or remove the Windows download.
