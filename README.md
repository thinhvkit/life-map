This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro
# Life Map - React Native GPS Life Logger

A daily life mapping app that passively tracks your GPS movements and visualizes them on an interactive map with timeline. Built with free/open-source libraries only.

**Bundle ID:** `com.thinhvo.lifemap`

## Tech Stack

- **React Native** (bare workflow or Expo dev client)
- **expo-location** - Foreground + background GPS tracking
- **expo-task-manager** - Background task registration (survives app kill)
- **expo-sensors** - Accelerometer for motion/activity detection
- **react-native-maps** - Map rendering with polylines
- **zustand** - State management
- **@react-native-async-storage/async-storage** - Persistence (→ SQLite later)
- **date-fns** - Date utilities

## Setup

```bash
# Option A: Expo dev client (recommended)
npx create-expo-app LifeMap --template expo-template-blank-typescript
cd LifeMap

# Option B: Bare React Native
npx react-native init LifeMap --template react-native-template-typescript
cd LifeMap
npx install-expo-modules@latest

# Core deps (all free)
npx expo install expo-location expo-task-manager expo-sensors
npm install react-native-maps
npm install @react-native-async-storage/async-storage
npm install zustand date-fns
npm install @react-navigation/native @react-navigation/bottom-tabs
npm install react-native-screens react-native-safe-area-context

# iOS
cd ios && pod install && cd ..
```

## Required Permissions

### Android (`android/app/src/main/AndroidManifest.xml`)
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
```

### iOS (`ios/LifeMap/Info.plist`)
```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Life Map uses your location to track daily movements</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Life Map needs background location to automatically log your travels</string>
<key>NSMotionUsageDescription</key>
<string>Life Map uses motion data to detect walking, driving, and cycling</string>
<key>UIBackgroundModes</key>
<array>
  <string>location</string>
</array>
```

### Expo (`app.json`)
```json
{
  "expo": {
    "plugins": [
      [
        "expo-location",
        {
          "locationAlwaysAndWhenInUsePermission": "Life Map needs background location to automatically log your travels.",
          "isAndroidBackgroundLocationEnabled": true,
          "isAndroidForegroundServiceEnabled": true
        }
      ]
    ],
    "ios": {
      "infoPlist": {
        "UIBackgroundModes": ["location"],
        "NSMotionUsageDescription": "Life Map uses motion data to detect walking, driving, and cycling"
      }
    }
  }
}
```

## Project Structure

```
src/
├── app/
│   └── App.tsx                 # Root navigator + tracking init
├── screens/
│   ├── MapScreen.tsx           # Map with route polylines + place markers
│   ├── TimelineScreen.tsx      # Chronological daily timeline
│   └── StatsScreen.tsx         # Activity breakdown + stats
├── services/
│   ├── tracking.ts             # expo-location GPS service + segment logic
│   ├── motionDetector.ts       # expo-sensors accelerometer classifier
│   ├── placeDetection.ts       # Dwell-time place recognition + geocoding
│   └── activityClassifier.ts   # Speed-based activity fallback
├── store/
│   └── trackingStore.ts        # Zustand state + AsyncStorage persistence
├── models/
│   └── types.ts                # TypeScript interfaces
├── utils/
│   ├── routeSimplify.ts        # Douglas-Peucker polyline compression
│   └── geo.ts                  # Haversine, formatting, color maps
└── hooks/
    └── useTracking.ts          # Tracking lifecycle + permission hooks
```

## How It Works

### Motion Detection Pipeline
```
Accelerometer (20Hz)
    ↓ magnitude = sqrt(x² + y² + z²)
    ↓ sliding window (2s)
    ↓ variance + zero-crossing rate
    ↓
Motion State (stationary/walking/running/cycling/driving)
    ↓ merged with GPS speed
    ↓
Final Activity Classification
    ↓ on transition (moving ↔ stationary)
    ↓
Segment Created (Trip or Visit)
```

### Battery Optimization
- **Stationary:** GPS drops to `Accuracy.Low`, 60s interval
- **Moving:** GPS uses `Accuracy.High`, 5s interval
- **Background:** `Accuracy.Balanced` with deferred batching
- **Accelerometer:** 20Hz (low power sensor)
- **Stationary debounce:** 2 min timer prevents false stops at red lights

### Segment Logic
- `TRIP`: continuous movement between places
- `VISIT`: stationary period at a location (> 5 min = place detection)
- Transition triggered by accelerometer motion state change
- Short trips (< 30s) are discarded as noise

## Tuning the Motion Classifier

The accelerometer variance thresholds in `motionDetector.ts` need tuning per device.
Test by logging variance values while performing each activity:

```
Stationary:  variance < 0.003
Driving:     0.003 - 0.02  (smooth vibration, no steps)
Walking:     0.01 - 0.08   (periodic ~2Hz steps)
Running:     > 0.08        (periodic ~3Hz steps)
Cycling:     0.005 - 0.08  (irregular, no clear steps)
```

## Roadmap

- [ ] SQLite migration for large datasets
- [ ] Animated route playback
- [ ] Place auto-labeling (Home/Work detection)
- [ ] Weekly/monthly stats
- [ ] GPX export
- [ ] Map style switching (satellite, dark)
- [ ] Pedometer integration (expo-sensors Pedometer)
- [ ] ML-based activity classifier improvement

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
