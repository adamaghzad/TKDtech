package com.tkdtech.scoring;

import android.content.Context;
import android.net.Uri;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Date;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import org.json.JSONObject;

/** User-selected, host-stopped backup of tournament data and the device license. */
final class BackupManager {
    interface Callback {
        void onSuccess(String message);
        void onError(String message);
    }

    private BackupManager() {}

    static boolean hostStopped() {
        String state = HostService.state();
        return "STOPPED".equals(state) || "FAILED".equals(state);
    }

    static void exportBackup(Context context, Uri destination, Callback callback) {
        new Thread(() -> {
            try {
                File files = context.getFilesDir();
                JSONObject manifest = new JSONObject();
                manifest.put("format", 1);
                manifest.put("application", "TKD Scoring Android Host");
                manifest.put("versionCode", BuildConfig.VERSION_CODE);
                manifest.put("createdAt", new Date().toString());
                manifest.put("contents", "SQLite tournament data and device-bound license; runtime excluded");
                OutputStream raw = context.getContentResolver().openOutputStream(destination, "w");
                if (raw == null) throw new IOException("The selected destination could not be opened.");
                try (OutputStream output = raw;
                     ZipOutputStream zip = new ZipOutputStream(new BufferedOutputStream(output))) {
                    writeEntry(zip, "backup-manifest.json", manifest.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    addDirectory(zip, new File(files, "data"), "data");
                    addDirectory(zip, new File(files, "license"), "license");
                }
                callback.onSuccess("Backup complete. Keep this ZIP private; it contains your tournament data and license.");
            } catch (Exception error) {
                callback.onError(message(error));
            }
        }, "tkd-backup-export").start();
    }

    static void importBackup(Context context, Uri source, Callback callback) {
        new Thread(() -> {
            File files = context.getFilesDir();
            File staging = new File(files, "restore-staging");
            File previousData = new File(files, ".data-before-restore");
            File previousLicense = new File(files, ".license-before-restore");
            try {
                delete(staging);
                delete(previousData);
                delete(previousLicense);
                staging.mkdirs();
                extract(context, source, staging);
                if (!new File(staging, "data/tkd-scoring.db").isFile()) throw new IOException("This ZIP is not a TKD Scoring backup: the SQLite database is missing.");
                File currentData = new File(files, "data");
                File currentLicense = new File(files, "license");
                boolean dataMoved = currentData.exists();
                boolean licenseMoved = currentLicense.exists();
                if (dataMoved && !currentData.renameTo(previousData)) throw new IOException("Could not stage the existing tournament data.");
                if (licenseMoved && !currentLicense.renameTo(previousLicense)) {
                    if (dataMoved) previousData.renameTo(currentData);
                    throw new IOException("Could not stage the existing license folder.");
                }
                try {
                    if (!new File(staging, "data").renameTo(currentData)) throw new IOException("Could not install the restored tournament data.");
                    File incomingLicense = new File(staging, "license");
                    if (incomingLicense.exists()) {
                        if (!incomingLicense.renameTo(currentLicense)) throw new IOException("Could not install the restored license folder.");
                    } else currentLicense.mkdirs();
                } catch (Exception failure) {
                    delete(currentData);
                    delete(currentLicense);
                    if (dataMoved) previousData.renameTo(currentData);
                    if (licenseMoved) previousLicense.renameTo(currentLicense);
                    throw failure;
                }
                delete(previousData);
                delete(previousLicense);
                delete(staging);
                callback.onSuccess("Restore complete. Start the host and verify the tournament and license before scoring.");
            } catch (Exception error) {
                delete(staging);
                callback.onError(message(error));
            }
        }, "tkd-backup-import").start();
    }

    private static void extract(Context context, Uri source, File staging) throws IOException {
        InputStream opened = context.getContentResolver().openInputStream(source);
        if (opened == null) throw new IOException("The selected backup could not be opened.");
        String root = staging.getCanonicalPath() + File.separator;
        int files = 0;
        try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(opened))) {
            byte[] buffer = new byte[64 * 1024];
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName();
                if (name.equals("backup-manifest.json")) continue;
                if (!(name.startsWith("data/") || name.startsWith("license/"))) throw new IOException("Unexpected file in backup: " + name);
                File target = new File(staging, name);
                if (!target.getCanonicalPath().startsWith(root)) throw new IOException("Unsafe path in backup.");
                if (entry.isDirectory()) {
                    target.mkdirs();
                    continue;
                }
                File parent = target.getParentFile();
                if (parent != null) parent.mkdirs();
                try (OutputStream output = new FileOutputStream(target)) {
                    int count;
                    while ((count = zip.read(buffer)) != -1) output.write(buffer, 0, count);
                }
                files++;
                if (files > 10000) throw new IOException("The backup contains too many files.");
            }
        }
    }

    private static void addDirectory(ZipOutputStream zip, File directory, String relative) throws IOException {
        if (!directory.exists()) return;
        File[] children = directory.listFiles();
        if (children == null) return;
        for (File child : children) {
            String name = relative + "/" + child.getName();
            if (child.isDirectory()) addDirectory(zip, child, name);
            else if (child.isFile()) {
                try (InputStream input = new FileInputStream(child)) {
                    zip.putNextEntry(new ZipEntry(name));
                    copy(input, zip);
                    zip.closeEntry();
                }
            }
        }
    }

    private static void writeEntry(ZipOutputStream zip, String name, byte[] bytes) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(bytes);
        zip.closeEntry();
    }

    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
    }

    private static String message(Exception error) {
        return error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
    }

    private static void delete(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) delete(child);
        file.delete();
    }
}
