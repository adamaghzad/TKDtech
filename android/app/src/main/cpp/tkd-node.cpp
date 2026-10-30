#include <jni.h>
#include <string>
#include <cstdlib>
#include <cstring>
#include <pthread.h>
#include <unistd.h>
#include <android/log.h>
#include "node.h"

static const char *LOGTAG = "TKD_NODE";
static int pipe_stdout[2];
static int pipe_stderr[2];
static pthread_t thread_stdout;
static pthread_t thread_stderr;
static bool outputRedirected = false;
static const size_t MAX_ENTRY = 4000;

static void *pump(int fd, android_LogPriority priority) {
    char buffer[2048];
    std::string pending;
    ssize_t count;
    while ((count = read(fd, buffer, sizeof(buffer))) > 0) {
        pending.append(buffer, count);
        size_t start = 0;
        size_t newline;
        while ((newline = pending.find('\n', start)) != std::string::npos) {
            while (newline - start > MAX_ENTRY) {
                __android_log_write(priority, LOGTAG, pending.substr(start, MAX_ENTRY).c_str());
                start += MAX_ENTRY;
            }
            __android_log_write(priority, LOGTAG, pending.substr(start, newline - start).c_str());
            start = newline + 1;
        }
        pending.erase(0, start);
        while (pending.size() > MAX_ENTRY) {
            __android_log_write(priority, LOGTAG, pending.substr(0, MAX_ENTRY).c_str());
            pending.erase(0, MAX_ENTRY);
        }
    }
    if (!pending.empty()) __android_log_write(priority, LOGTAG, pending.c_str());
    return nullptr;
}

static void *stdoutThread(void *) { return pump(pipe_stdout[0], ANDROID_LOG_INFO); }
static void *stderrThread(void *) { return pump(pipe_stderr[0], ANDROID_LOG_ERROR); }

static int redirectOutput() {
    setvbuf(stdout, nullptr, _IONBF, 0);
    if (pipe(pipe_stdout) != 0) return -1;
    dup2(pipe_stdout[1], STDOUT_FILENO);
    setvbuf(stderr, nullptr, _IONBF, 0);
    if (pipe(pipe_stderr) != 0) return -1;
    dup2(pipe_stderr[1], STDERR_FILENO);
    if (pthread_create(&thread_stdout, nullptr, stdoutThread, nullptr) != 0) return -1;
    if (pthread_create(&thread_stderr, nullptr, stderrThread, nullptr) != 0) return -1;
    outputRedirected = true;
    return 0;
}

static void drainOutput() {
    if (!outputRedirected) return;
    close(STDOUT_FILENO);
    close(pipe_stdout[1]);
    close(STDERR_FILENO);
    close(pipe_stderr[1]);
    pthread_join(thread_stdout, nullptr);
    pthread_join(thread_stderr, nullptr);
    outputRedirected = false;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_tkdtech_scoring_HostService_startNodeWithArguments(
        JNIEnv *env,
        jobject,
        jobjectArray arguments) {
    const jsize argc = env->GetArrayLength(arguments);
    int total = 0;
    for (int index = 0; index < argc; index++) {
        auto value = (jstring)env->GetObjectArrayElement(arguments, index);
        const char *text = env->GetStringUTFChars(value, nullptr);
        total += strlen(text) + 1;
        env->ReleaseStringUTFChars(value, text);
    }

    char *buffer = (char *)calloc(total, sizeof(char));
    char *argv[argc];
    char *cursor = buffer;
    for (int index = 0; index < argc; index++) {
        auto value = (jstring)env->GetObjectArrayElement(arguments, index);
        const char *text = env->GetStringUTFChars(value, nullptr);
        const size_t length = strlen(text);
        memcpy(cursor, text, length + 1);
        argv[index] = cursor;
        cursor += length + 1;
        env->ReleaseStringUTFChars(value, text);
    }

    if (redirectOutput() == -1) {
        __android_log_write(ANDROID_LOG_ERROR, LOGTAG, "Could not redirect Node output to logcat.");
    }
    const int result = node::Start(argc, argv);
    free(buffer);
    drainOutput();
    return (jint)result;
}
