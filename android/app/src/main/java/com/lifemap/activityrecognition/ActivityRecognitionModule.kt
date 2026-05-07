package com.lifemap.activityrecognition

import android.Manifest
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityRecognitionClient
import com.google.android.gms.location.ActivityRecognitionResult
import com.google.android.gms.location.DetectedActivity
import android.util.Log
import com.lifemap.BuildConfig
import com.lifemap.codegen.NativeActivityRecognitionSpec

class ActivityRecognitionModule(reactContext: ReactApplicationContext) :
    NativeActivityRecognitionSpec(reactContext) {

    private var client: ActivityRecognitionClient? = null
    private var pendingIntent: PendingIntent? = null
    private var receiver: ActivityReceiver? = null
    private var isRunning = false

    companion object {
        const val ACTION = "com.lifemap.ACTIVITY_RECOGNITION"

        const val NAME = NativeActivityRecognitionSpec.NAME

        fun activityTypeToString(type: Int): String = when (type) {
            DetectedActivity.STILL -> "stationary"
            DetectedActivity.WALKING -> "walking"
            DetectedActivity.RUNNING -> "running"
            DetectedActivity.ON_BICYCLE -> "cycling"
            DetectedActivity.IN_VEHICLE -> "automotive"
            DetectedActivity.ON_FOOT -> "walking"
            DetectedActivity.TILTING -> "unknown"
            else -> "unknown"
        }
    }

    override fun startActivityUpdates(intervalMs: Double, promise: Promise) {
        if (isRunning) {
            promise.resolve(null)
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val granted = ContextCompat.checkSelfPermission(
                reactApplicationContext,
                Manifest.permission.ACTIVITY_RECOGNITION
            ) == PackageManager.PERMISSION_GRANTED

            if (!granted) {
                promise.reject(
                    "PERMISSION_DENIED",
                    "ACTIVITY_RECOGNITION permission not granted"
                )
                return
            }
        }

        try {
            val context = reactApplicationContext

            val intent = Intent(ACTION)
            intent.setPackage(context.packageName)

            pendingIntent = PendingIntent.getBroadcast(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )

            receiver = ActivityReceiver()
            val filter = IntentFilter(ACTION)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                context.registerReceiver(receiver, filter)
            }
            Log.d("ActivityRecognition", "Receiver registered for action: $ACTION")

            client = ActivityRecognition.getClient(context)
            client?.requestActivityUpdates(intervalMs.toLong(), pendingIntent!!)
                ?.addOnSuccessListener {
                    isRunning = true
                    promise.resolve(null)
                }
                ?.addOnFailureListener { e ->
                    promise.reject("START_FAILED", e.message, e)
                }
        } catch (e: Exception) {
            promise.reject("START_ERROR", e.message, e)
        }
    }

    override fun stopActivityUpdates(promise: Promise) {
        try {
            pendingIntent?.let { pi -> client?.removeActivityUpdates(pi) }
            receiver?.let { r ->
                try { reactApplicationContext.unregisterReceiver(r) } catch (_: Exception) {}
            }

            isRunning = false
            client = null
            pendingIntent = null
            receiver = null

            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("STOP_ERROR", e.message, e)
        }
    }

    override fun queryActivities(startMs: Double, endMs: Double, promise: Promise) {
        promise.resolve(Arguments.createArray())
    }

    override fun isAvailable(promise: Promise) {
        try {
            val result = GoogleApiAvailability.getInstance()
                .isGooglePlayServicesAvailable(reactApplicationContext)
            promise.resolve(result == ConnectionResult.SUCCESS)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    override fun invalidate() {
        try {
            pendingIntent?.let { pi -> client?.removeActivityUpdates(pi) }
            receiver?.let { r ->
                try { reactApplicationContext.unregisterReceiver(r) } catch (_: Exception) {}
            }
        } catch (_: Exception) {}
        super.invalidate()
    }

    inner class ActivityReceiver : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            Log.d("ActivityRecognition", "onReceive called, intent=$intent")
            if (intent == null) return

            // Debug simulation: accept plain extras
            val debugActivity = intent.getStringExtra("activity")
            if (debugActivity != null) {
                val event = Arguments.createMap().apply {
                    putString("activity", debugActivity)
                    putInt("confidence", intent.getIntExtra("confidence", 80))
                    putDouble("timestamp", System.currentTimeMillis().toDouble())
                }
                sendEvent(event)
                return
            }

            val result = ActivityRecognitionResult.extractResult(intent) ?: return
            val mostProbable = result.mostProbableActivity

            val event = Arguments.createMap().apply {
                putString("activity", activityTypeToString(mostProbable.type))
                putInt("confidence", mostProbable.confidence)
                putDouble("timestamp", System.currentTimeMillis().toDouble())
            }

            sendEvent(event)
        }
    }

    private fun sendEvent(params: WritableMap) {
        emitOnActivityChange(params)
    }
}
