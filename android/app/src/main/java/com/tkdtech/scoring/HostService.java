package com.tkdtech.scoring;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.json.JSONObject;

public final class HostService extends Service {
    private static final String TAG = "TKD_HOST";
    private static final String CHANNEL = "offline-host";
    private static final int NOTIFICATION_ID = 3000;
    private static final String ACTION_START = "com.tkdtech.scoring.action.START";
    private static final String ACTION_STOP = "com.tkdtech.scoring.action.STOP";
    private static volatile String state = "STOPPED";
    private static volatile String detail = "The offline host is not running.";

    static {
        System.loadLibrary("node");
        System.loadLibrary("tkd-node");
    }

    private Thread nodeThread;
    private volatile boolean stopRequested;
    private final android.os.Handler mainHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable forcedStop = () -> { if (stopRequested) System.exit(0); };
    private String controlToken;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    public static void start(Context context) {
        Intent intent = new Intent(context, HostService.class).setAction(ACTION_START);
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
        else context.startService(intent);
    }

    public static void stop(Context context) {
        context.startService(new Intent(context, HostService.class).setAction(ACTION_STOP));
    }

    public static String state() { return state; }
    public static String detail() { return detail; }

    @Override public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopHost();
            return START_NOT_STICKY;
        }
        if (nodeThread == null || !nodeThread.isAlive()) startHost();
        return START_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private void startHost() {
        stopRequested = false;
        controlToken = UUID.randomUUID() + UUID.randomUUID().toString();
        setState("PREPARING", "Preparing the offline runtime. Tournament data is preserved.");
        startForegroundWithNotification();
        acquireLocks();
        nodeThread = new Thread(this::runNode, "tkd-node-main");
        nodeThread.setDaemon(true);
        nodeThread.start();
    }

    private void runNode() {
        int exitCode = 1;
        boolean nodeStarted = false;
        try {
            File runtime = AssetRuntime.ensureExtracted(this);
            if (stopRequested) {
                finishService();
                return;
            }
            File config = writeConfiguration(runtime);
            File bootstrap = new File(runtime, "bootstrap.mjs");
            String script = "import { readFileSync } from 'node:fs';\n"
                + "const values = JSON.parse(readFileSync(process.argv[2], 'utf8'));\n"
                + "for (const [key, value] of Object.entries(values)) process.env[key] = value;\n"
                + "process.chdir(process.argv[3]);\n"
                + "await import('./server.mjs');\n";
            write(new FileOutputStream(bootstrap), script);

            setState("STARTING", "Starting SQLite, HTTP, WebSockets and the operator interface.");
            updateNotification();
            nodeStarted = true;
            exitCode = startNodeWithArguments(new String[] {
                "node", bootstrap.getAbsolutePath(), config.getAbsolutePath(), runtime.getAbsolutePath()
            });
            Log.i(TAG, "Node runtime exited with code " + exitCode);
            setState(stopRequested ? "STOPPED" : "FAILED", stopRequested
                ? "The offline host was stopped."
                : "The local service stopped unexpectedly. Reopen TKD Scoring to restart it.");
        } catch (Throwable error) {
            Log.e(TAG, "Could not start the Android host", error);
            setState("FAILED", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
        }
        finishService();
        if (nodeStarted && !stopRequested) System.exit(exitCode);
    }

    private File writeConfiguration(File runtime) throws Exception {
        File home = new File(getFilesDir(), "home");
        File cache = new File(getCacheDir(), "node");
        File data = new File(getFilesDir(), "data");
        File license = new File(getFilesDir(), "license");
        home.mkdirs();
        cache.mkdirs();
        data.mkdirs();
        license.mkdirs();

        String androidId = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
        if (androidId == null || androidId.trim().isEmpty()) androidId = Build.FINGERPRINT;
        JSONObject values = new JSONObject();
        values.put("HOME", home.getAbsolutePath());
        values.put("TMPDIR", cache.getAbsolutePath());
        values.put("XDG_CACHE_HOME", cache.getAbsolutePath());
        values.put("NODE_ENV", "production");
        values.put("NODE_NO_WARNINGS", "1");
        values.put("NEXT_TELEMETRY_DISABLED", "1");
        values.put("PORT", "3000");
        values.put("WEB_INTERNAL_URL", "http://127.0.0.1:3001");
        values.put("TKD_MODE", "LOCAL");
        values.put("NEXT_PUBLIC_TKD_MODE", "LOCAL");
        values.put("NEXT_PUBLIC_SUPABASE_URL", "");
        values.put("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
        values.put("SUPABASE_SERVICE_ROLE_KEY", "");
        values.put("SEED_DEVELOPMENT", "false");
        values.put("ALLOW_DEMO_LOGIN", "false");
        values.put("TKD_DATABASE_PATH", new File(data, "tkd-scoring.db").getAbsolutePath());
        values.put("TKD_LICENSE_DIRECTORY", license.getAbsolutePath());
        values.put("TKD_DESKTOP_LICENSE_REQUIRED", "true");
        values.put("TKD_ANDROID_HOST", "true");
        values.put("TKD_EMBEDDED_NEXT", "true");
        values.put("TKD_ANDROID_CONTROL_TOKEN", controlToken);
        values.put("TKD_MACHINE_ID", "ANDROID-ID:" + androidId);
        values.put("APP_PUBLIC_URL", NetworkAddresses.preferredOrigin(3000));

        File config = new File(getFilesDir(), "android-host-config.json");
        write(new FileOutputStream(config), values.toString());
        return config;
    }

    private void stopHost() {
        stopRequested = true;
        setState("STOPPING", "Pausing active timers and closing the local service safely.");
        updateNotification();
        new Thread(() -> {
            try {
                HttpURLConnection connection = (HttpURLConnection)new URL("http://127.0.0.1:3000/api/v1/android/shutdown").openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(1500);
                connection.setReadTimeout(2500);
                connection.setFixedLengthStreamingMode(0);
                connection.setRequestProperty("Authorization", "Bearer " + controlToken);
                connection.getResponseCode();
                connection.disconnect();
            } catch (Exception error) {
                Log.w(TAG, "Graceful shutdown is not available; closing the host process.", error);
                if (nodeThread != null && nodeThread.isAlive()) System.exit(0);
                else finishService();
            }
        }, "tkd-host-stop").start();
        mainHandler.postDelayed(forcedStop, 10_000);
    }

    private void startForegroundWithNotification() {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTIFICATION_ID, notification);
    }

    private Notification buildNotification() {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, HostService.class).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return builder.setContentTitle(getString(R.string.app_name))
            .setContentText(detail)
            .setSmallIcon(R.drawable.ic_tkd)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(0, "Stop host", stop)
            .build();
    }

    private void updateNotification() {
        NotificationManager manager = (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification());
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, getString(R.string.host_channel), NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Keeps the offline tournament HTTP and WebSocket service available.");
        NotificationManager manager = (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private void acquireLocks() {
        PowerManager power = (PowerManager)getSystemService(POWER_SERVICE);
        if (power != null) {
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "tkd:offline-host");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        }
        WifiManager wifi = (WifiManager)getApplicationContext().getSystemService(WIFI_SERVICE);
        if (wifi != null) {
            wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "tkd:offline-host");
            wifiLock.setReferenceCounted(false);
            wifiLock.acquire();
        }
    }

    private void finishService() {
        mainHandler.removeCallbacks(forcedStop);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        stopForeground(true);
        stopSelf();
    }

    private static void write(FileOutputStream output, String value) throws Exception {
        try (FileOutputStream stream = output) { stream.write(value.getBytes(StandardCharsets.UTF_8)); }
    }

    private static void setState(String next, String message) {
        state = next;
        detail = message;
    }

    private native int startNodeWithArguments(String[] arguments);
}
