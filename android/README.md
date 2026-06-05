# Android APK wrapper

This directory wraps the static Chengdu schools map as a native Android WebView app.

## Local build

Install JDK 17, Android SDK, and Gradle 8.10+, then run:

```bash
gradle -p android :app:assembleDebug
```

The debug APK will be generated at:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## GitHub Actions build

The repository includes `.github/workflows/build-android-apk.yml`. Push to `main` or run the workflow manually, then download the `chengdu-schools-map-debug-apk` artifact from GitHub Actions.
