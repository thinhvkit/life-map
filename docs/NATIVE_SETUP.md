# Native Activity Recognition Setup Guide

## What this gives you

Instead of raw accelerometer math, you get Apple/Google's on-device ML classifiers:

| Feature | expo-sensors (old) | Native APIs (new) |
|---|---|---|
| Accuracy | ~60-70% | ~90-95% |
| Activities | walk/run/drive/cycle | walk/run/drive/cycle/automotive |
| Bus vs Car | ❌ can't distinguish | ✅ separate classifications |
| Battery | 20Hz accelerometer polling | Event-driven, near zero drain |
| Background | Stops when app killed | iOS: queries history on resume |
| Latency | ~2s sliding window | ~3-5s native batching |

## iOS Setup

### 1. Add CoreMotion framework

In Xcode → your target → General → Frameworks:
- Add `CoreMotion.framework`

### 2. Info.plist permission

```xml
<key>NSMotionUsageDescription</key>
<string>Life Map uses motion data to detect walking, driving, and cycling</string>
```

### 3. Add Swift bridging header (if not already present)

Create `ios/LifeMap/LifeMap-Bridging-Header.h`:
```objc
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
```

### 4. Copy native files

Copy these into your Xcode project:
```
ios/ActivityRecognition/
  ├── ActivityRecognitionModule.swift
  └── ActivityRecognitionBridge.m
```

Add both files to your Xcode target.

### 5. Pod install

```bash
cd ios && pod install
```

---

## Android Setup

### 1. Add Google Play Services dependency

In `android/app/build.gradle`:
```groovy
dependencies {
    // ... existing deps
    implementation 'com.google.android.gms:play-services-location:21.3.0'
}
```

### 2. AndroidManifest.xml permissions

```xml
<!-- Activity Recognition (Android 10+) -->
<uses-permission android:name="android.permission.ACTIVITY_RECOGNITION" />

<!-- For the broadcast receiver -->
<uses-permission android:name="com.google.android.gms.permission.ACTIVITY_RECOGNITION" />
```

### 3. Request runtime permission (Android 10+)

In your App.tsx or permission flow:
```typescript
import { PermissionsAndroid, Platform } from 'react-native';

if (Platform.OS === 'android' && Platform.Version >= 29) {
  await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
    {
      title: 'Activity Recognition',
      message: 'Life Map needs to detect your activity type (walking, driving, etc.)',
      buttonPositive: 'Allow',
    }
  );
}
```

### 4. Register the package

In `MainApplication.kt`:
```kotlin
import com.thinhvo.lifemap.activityrecognition.ActivityRecognitionPackage

override fun getPackages(): List<ReactPackage> =
    PackageList(this).packages.apply {
        add(ActivityRecognitionPackage())
    }
```

### 5. Copy native files

```
android/app/src/main/java/com/thinhvo/lifemap/activityrecognition/
  ├── ActivityRecognitionModule.kt
  └── ActivityRecognitionPackage.kt
```

---

## How the fallback works

```
App starts
    ↓
motionDetector.start()
    ↓
Check: activityRecognition.isAvailable()?
    ├── YES → Use native (Tier 1)
    │         CMMotionActivityManager / ActivityRecognitionClient
    │         On-device ML, ~95% accurate, near-zero battery
    │
    └── NO → Fallback to accelerometer (Tier 2)
              expo-sensors Accelerometer at 20Hz
              Variance + step frequency analysis, ~65% accurate
```

## iOS Exclusive: History Queries

When app launches after being killed, you can query what happened:

```typescript
import { motionDetector } from './services/motionDetector';

// Get activities from the last 6 hours
const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
const history = await motionDetector.queryHistory(sixHoursAgo, Date.now());

// Returns array of MotionState with timestamps
// Use to reconstruct segments that were missed
```

This is a killer feature — CoreMotion stores ~7 days of activity data
on-device, so you can fill gaps even after a crash or restart.
Android doesn't support this (Activity Recognition is fire-and-forget).

## Testing

```bash
# iOS: Run on physical device (simulator has no CoreMotion)
npx react-native run-ios --device

# Android: Debug APK
cd android && ./gradlew assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

Walk around, drive, sit still — check console logs for:
```
[MotionDetector] Started (native)
[Tracking] Motion: STILL → MOVING
[Tracking] Activity: walking (confidence: 100, source: native)
```
