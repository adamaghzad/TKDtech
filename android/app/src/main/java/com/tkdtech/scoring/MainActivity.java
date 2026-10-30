package com.tkdtech.scoring;

import android.Manifest;
import android.app.AlertDialog;
import android.app.Dialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.app.Activity;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER = 41;
    private static final int BACKUP_CREATE = 42;
    private static final int BACKUP_RESTORE = 43;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Dialog> popups = new ArrayList<>();
    private WebView webView;
    private LinearLayout root;
    private LinearLayout header;
    private TextView status;
    private ValueCallback<Uri[]> fileChooser;
    private boolean hostLoaded;
    private boolean healthCheckRunning;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;

    private final Runnable statusPoller = new Runnable() {
        @Override public void run() {
            String state = HostService.state();
            if (!hostLoaded) status.setText(state + " · " + HostService.detail());
            if ("STOPPED".equals(state) && hostLoaded) {
                hostLoaded = false;
                webView.loadUrl("file:///android_asset/host-loading.html");
            }
            if ("FAILED".equals(state)) status.setTextColor(Color.rgb(255, 120, 130));
            else status.setTextColor(Color.rgb(215, 255, 95));
            if (!hostLoaded && !healthCheckRunning && !"FAILED".equals(state)) checkHealth();
            handler.postDelayed(this, 1000);
        }
    };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        buildInterface();
        configureWebView(webView);
        webView.loadUrl("file:///android_asset/host-loading.html");
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 33);
        }
        HostService.start(this);
        handler.post(statusPoller);
    }

    private void buildInterface() {
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(7, 9, 15));

        header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(16), dp(8), dp(8), dp(8));
        root.addView(header, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(68)));

        LinearLayout brand = new LinearLayout(this);
        brand.setOrientation(LinearLayout.VERTICAL);
        header.addView(brand, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        TextView title = new TextView(this);
        title.setText("TKD SCORING");
        title.setTextColor(Color.WHITE);
        title.setTextSize(18);
        title.setTypeface(null, android.graphics.Typeface.BOLD_ITALIC);
        brand.addView(title);
        status = new TextView(this);
        status.setText("Starting the offline Android host…");
        status.setTextColor(Color.rgb(215, 255, 95));
        status.setTextSize(10);
        status.setMaxLines(2);
        brand.addView(status);

        Button menu = new Button(this);
        menu.setText("HOST");
        menu.setTextSize(11);
        menu.setOnClickListener(this::showHostMenu);
        header.addView(menu, new LinearLayout.LayoutParams(dp(74), dp(46)));

        webView = new WebView(this);
        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
    }

    private void configureWebView(WebView target) {
        WebSettings settings = target.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        target.setBackgroundColor(Color.rgb(7, 9, 15));
        target.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(target, false);
        target.setWebViewClient(new LocalWebViewClient());
        target.setWebChromeClient(new HostChromeClient());
        target.setDownloadListener(new LocalDownloadListener(this));
    }

    private void checkHealth() {
        healthCheckRunning = true;
        new Thread(() -> {
            boolean healthy = false;
            try {
                HttpURLConnection connection = (HttpURLConnection)new URL("http://127.0.0.1:3000/api/v1/health").openConnection();
                connection.setConnectTimeout(1000);
                connection.setReadTimeout(1500);
                healthy = connection.getResponseCode() == 200;
                connection.disconnect();
            } catch (Exception ignored) {
                // The runtime may still be extracting or starting Next.js.
            }
            final boolean ready = healthy;
            runOnUiThread(() -> {
                healthCheckRunning = false;
                if (ready && !hostLoaded) {
                    hostLoaded = true;
                    status.setText("READY · offline host on this phone");
                    webView.loadUrl("http://127.0.0.1:3000/login");
                }
            });
        }, "tkd-health-check").start();
    }

    private void showHostMenu(View anchor) {
        PopupMenu menu = new PopupMenu(this, anchor);
        if (BackupManager.hostStopped()) menu.getMenu().add("Start host");
        menu.getMenu().add("Judge network / hotspot");
        menu.getMenu().add("Reload operator");
        menu.getMenu().add("Data & backup");
        menu.getMenu().add("Backup data (host stopped)");
        menu.getMenu().add("Restore data (host stopped)");
        menu.getMenu().add("Stop host");
        menu.setOnMenuItemClickListener(item -> {
            String title = item.getTitle().toString();
            if (title.startsWith("Start")) startHostAgain();
            else if (title.startsWith("Judge")) showNetworkHelp();
            else if (title.startsWith("Reload")) webView.reload();
            else if (title.startsWith("Data")) showDataHelp();
            else if (title.startsWith("Backup")) beginBackup();
            else if (title.startsWith("Restore")) beginRestore();
            else confirmStop();
            return true;
        });
        menu.show();
    }

    private void showNetworkHelp() {
        String addresses = NetworkAddresses.join(NetworkAddresses.urls(3000));
        String message = "CURRENT PHONE ADDRESSES\n" + addresses + "\n\n"
            + "ROUTER (recommended)\nConnect this phone and every judge device to the same router Wi-Fi. Internet is not required. Disable AP/client isolation.\n\n"
            + "ANDROID HOTSPOT\nEnable this phone's hotspot and connect the judge devices directly to it. Local scoring does not require mobile data. You do not need a router and hotspot at the same time.\n\n"
            + "Use a newly generated QR code. Never use 127.0.0.1 or localhost on another device. Hotspot and simultaneous Wi-Fi sharing support varies by phone model.";
        showScrollableMessage("Judge network / hotspot", message);
    }

    private void showDataHelp() {
        String message = "SQLite tournament data and the device-bound license are stored in this app's private storage, outside the replaceable runtime. Updating the APK does not intentionally delete them.\n\n"
            + "Uninstalling Android apps normally deletes private data. Choose Backup data from the HOST menu before uninstalling or moving phones. The ZIP contains tournament data and the license; keep it private.\n\n"
            + "Stop the host before backup or restore. After restoring, start the host and verify the tournament, license and a recovered timer before scoring. Licenses are device/installation-bound: a different phone may require a support-approved license transfer.";
        showScrollableMessage("Data & backup", message);
    }

    private void startHostAgain() {
        hostLoaded = false;
        webView.loadUrl("file:///android_asset/host-loading.html");
        HostService.start(this);
    }

    private void beginBackup() {
        if (!BackupManager.hostStopped()) {
            showScrollableMessage("Stop the host first", "Use Stop host in the HOST menu, wait for STOPPED, then choose Backup data. This keeps SQLite and the license consistent.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/zip")
            .putExtra(Intent.EXTRA_TITLE, "TKD-Scoring-backup.zip");
        startActivityForResult(intent, BACKUP_CREATE);
    }

    private void beginRestore() {
        if (!BackupManager.hostStopped()) {
            showScrollableMessage("Stop the host first", "Use Stop host in the HOST menu, wait for STOPPED, then choose Restore data. Never restore over a running tournament service.");
            return;
        }
        new AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog)
            .setTitle("Replace data on this phone?")
            .setMessage("The selected backup replaces this phone's tournament database and license. Keep a separate backup of the current data first.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Choose backup", (dialog, which) -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("application/zip");
                startActivityForResult(intent, BACKUP_RESTORE);
            }).show();
    }

    private BackupManager.Callback backupCallback() {
        return new BackupManager.Callback() {
            @Override public void onSuccess(String message) { runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show()); }
            @Override public void onError(String message) { runOnUiThread(() -> showScrollableMessage("Backup operation failed", message)); }
        };
    }

    private void showScrollableMessage(String title, String message) {
        ScrollView scroll = new ScrollView(this);
        TextView text = new TextView(this);
        text.setText(message);
        text.setTextSize(14);
        text.setTextColor(Color.WHITE);
        text.setPadding(dp(20), dp(12), dp(20), dp(20));
        text.setTextIsSelectable(true);
        scroll.addView(text);
        new AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog)
            .setTitle(title)
            .setView(scroll)
            .setPositiveButton("Close", null)
            .show();
    }

    private void confirmStop() {
        new AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog)
            .setTitle("Stop the offline host?")
            .setMessage("Judge devices will disconnect. Active timers are paused and persisted for operator confirmation before the next start.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Stop host", (dialog, which) -> {
                HostService.stop(this);
                Toast.makeText(this, "Stopping the host safely…", Toast.LENGTH_SHORT).show();
            })
            .show();
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER && fileChooser != null) {
            fileChooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileChooser = null;
            return;
        }
        if (resultCode != RESULT_OK || data == null || data.getData() == null) return;
        if (requestCode == BACKUP_CREATE) {
            Toast.makeText(this, "Writing the backup…", Toast.LENGTH_SHORT).show();
            BackupManager.exportBackup(this, data.getData(), backupCallback());
        } else if (requestCode == BACKUP_RESTORE) {
            Toast.makeText(this, "Restoring the backup…", Toast.LENGTH_SHORT).show();
            BackupManager.importBackup(this, data.getData(), backupCallback());
        }
    }

    @Override public void onBackPressed() {
        if (customView != null) {
            new HostChromeClient().onHideCustomView();
            return;
        }
        if (!popups.isEmpty()) {
            popups.remove(popups.size() - 1).dismiss();
            return;
        }
        if (webView.canGoBack()) webView.goBack();
        else moveTaskToBack(true);
    }

    @Override protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        for (Dialog popup : popups) popup.dismiss();
        popups.clear();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private final class LocalWebViewClient extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String host = uri.getHost() == null ? "" : uri.getHost();
            if (host.equals("127.0.0.1") || host.equals("localhost") || host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.") || host.startsWith("172.")) return false;
            if (uri.getScheme() != null && (uri.getScheme().equals("http") || uri.getScheme().equals("https"))) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    return true;
                } catch (Exception error) {
                    Toast.makeText(MainActivity.this, "No browser is available for this link.", Toast.LENGTH_SHORT).show();
                    return true;
                }
            }
            return true;
        }
    }

    private final class HostChromeClient extends WebChromeClient {
        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileChooser != null) fileChooser.onReceiveValue(null);
            fileChooser = callback;
            try {
                startActivityForResult(params.createIntent(), FILE_CHOOSER);
                return true;
            } catch (Exception error) {
                fileChooser = null;
                Toast.makeText(MainActivity.this, "The file picker could not be opened.", Toast.LENGTH_SHORT).show();
                return false;
            }
        }

        @Override public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            Dialog dialog = new Dialog(MainActivity.this, android.R.style.Theme_Material_NoActionBar);
            LinearLayout layout = new LinearLayout(MainActivity.this);
            layout.setOrientation(LinearLayout.VERTICAL);
            Button close = new Button(MainActivity.this);
            close.setText("Close Public TV");
            close.setOnClickListener(button -> dialog.dismiss());
            layout.addView(close, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
            WebView popup = new WebView(MainActivity.this);
            configureWebView(popup);
            layout.addView(popup, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
            dialog.setContentView(layout);
            dialog.setOnDismissListener(ignored -> {
                popup.destroy();
                popups.remove(dialog);
            });
            dialog.show();
            popups.add(dialog);
            WebView.WebViewTransport transport = (WebView.WebViewTransport)resultMsg.obj;
            transport.setWebView(popup);
            resultMsg.sendToTarget();
            return true;
        }

        @Override public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) {
                callback.onCustomViewHidden();
                return;
            }
            customView = view;
            customViewCallback = callback;
            header.setVisibility(View.GONE);
            webView.setVisibility(View.GONE);
            root.addView(view, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }

        @Override public void onHideCustomView() {
            if (customView == null) return;
            root.removeView(customView);
            customView = null;
            header.setVisibility(View.VISIBLE);
            webView.setVisibility(View.VISIBLE);
            if (customViewCallback != null) customViewCallback.onCustomViewHidden();
            customViewCallback = null;
        }
    }

    private static final class LocalDownloadListener implements DownloadListener {
        private final Context context;
        LocalDownloadListener(Context context) { this.context = context; }

        @Override public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) request.addRequestHeader("Cookie", cookie);
                request.addRequestHeader("User-Agent", userAgent);
                request.setMimeType(mimeType);
                String filename = URLUtil.guessFileName(url, contentDisposition, mimeType);
                request.setTitle(filename);
                request.setDescription("TKD Scoring export");
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, filename);
                DownloadManager manager = (DownloadManager)context.getSystemService(DOWNLOAD_SERVICE);
                if (manager != null) manager.enqueue(request);
                Toast.makeText(context, "Export saved in the app's Download folder.", Toast.LENGTH_LONG).show();
            } catch (Exception error) {
                Toast.makeText(context, "The export could not be downloaded.", Toast.LENGTH_LONG).show();
            }
        }
    }
}
