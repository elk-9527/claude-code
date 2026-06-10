package com.crossscreen.tablet

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.WindowManager
import android.widget.ImageView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket

/**
 * 前台服务,职责:
 *  1. 监听 TCP 5566(adb forward 经 USB 转发到这里)
 *  2. 解析 PC 来的 NDJSON 指令,调用无障碍服务注入
 *  3. 管理悬浮窗虚拟光标
 */
class BridgeService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var serverJob: Job? = null
    private var serverSocket: ServerSocket? = null
    private var client: Socket? = null
    private var out: OutputStream? = null

    private val main = Handler(Looper.getMainLooper())
    private var cursorView: ImageView? = null
    private var wm: WindowManager? = null
    private var lp: WindowManager.LayoutParams? = null

    private var screenW = 0
    private var screenH = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ref = this
        startForegroundNotice()
        measureScreen()
        startServer()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        ref = null
        scope.cancel()
        try { client?.close() } catch (_: Exception) {}
        try { serverSocket?.close() } catch (_: Exception) {}
        removeCursor()
        super.onDestroy()
    }

    // ---------- 屏幕尺寸 ----------
    private fun measureScreen() {
        val wmgr = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val b = wmgr.currentWindowMetrics.bounds
            screenW = b.width(); screenH = b.height()
        } else {
            val dm = DisplayMetrics()
            @Suppress("DEPRECATION") wmgr.defaultDisplay.getRealMetrics(dm)
            screenW = dm.widthPixels; screenH = dm.heightPixels
        }
    }

    // ---------- TCP 服务 ----------
    private fun startServer() {
        serverJob = scope.launch {
            try {
                serverSocket = ServerSocket(PORT)
                while (true) {
                    val sock = serverSocket!!.accept()
                    handleClient(sock)
                }
            } catch (e: Exception) {
                // 服务器 socket 关闭即退出
            }
        }
    }

    private fun handleClient(sock: Socket) {
        // 单连接模型:新连接挤掉旧连接
        try { client?.close() } catch (_: Exception) {}
        client = sock
        sock.tcpNoDelay = true
        out = sock.getOutputStream()
        val reader = BufferedReader(InputStreamReader(sock.getInputStream(), Charsets.UTF_8))
        BridgeState.connected.postValue(true)
        try {
            var line: String?
            while (reader.readLine().also { line = it } != null) {
                val l = line ?: continue
                if (l.isBlank()) continue
                try { dispatch(JSONObject(l)) } catch (_: Exception) {}
            }
        } catch (_: Exception) {
        } finally {
            BridgeState.connected.postValue(false)
            main.post { removeCursor() }
            try { sock.close() } catch (_: Exception) {}
            if (client === sock) client = null
        }
    }

    private fun sendJson(obj: JSONObject) {
        val o = out ?: return
        try { o.write((obj.toString() + "\n").toByteArray(Charsets.UTF_8)); o.flush() } catch (_: Exception) {}
    }

    // ---------- 指令分发 ----------
    private fun dispatch(msg: JSONObject) {
        when (msg.optString("type")) {
            "hello" -> {
                sendJson(JSONObject().apply {
                    put("type", "welcome")
                    put("name", Build.MODEL)
                    put("model", Build.MODEL)
                    put("w", screenW)
                    put("h", screenH)
                })
                reportStatus()
            }
            "ping" -> sendJson(JSONObject().apply { put("type", "pong"); put("t", msg.optLong("t")) })
            "enter" -> main.post { showCursorAt(msg.optDouble("x"), msg.optDouble("y")) }
            "leave" -> main.post { removeCursor() }
            "cursor" -> main.post { moveCursor(msg.optDouble("x"), msg.optDouble("y")) }
            "tap" -> {
                val (px, py) = denorm(msg.optDouble("x"), msg.optDouble("y"))
                InputAccessibilityService.instance?.tap(px, py)
            }
            "longpress" -> {
                val (px, py) = denorm(msg.optDouble("x"), msg.optDouble("y"))
                InputAccessibilityService.instance?.longPress(px, py)
            }
            "swipe" -> {
                val (x1, y1) = denorm(msg.optDouble("x1"), msg.optDouble("y1"))
                val (x2, y2) = denorm(msg.optDouble("x2"), msg.optDouble("y2"))
                InputAccessibilityService.instance?.swipe(x1, y1, x2, y2, msg.optLong("duration", 200))
            }
            "text" -> InputAccessibilityService.instance?.inputText(msg.optString("value"))
            "key" -> {
                when (val code = msg.optString("code")) {
                    "DEL" -> InputAccessibilityService.instance?.backspace()
                    "ENTER" -> InputAccessibilityService.instance?.inputText("\n")
                    "TAB" -> InputAccessibilityService.instance?.inputText("\t")
                    else -> InputAccessibilityService.instance?.globalAction(code)
                }
            }
        }
    }

    private fun denorm(nx: Double, ny: Double): Pair<Float, Float> =
        Pair((nx * screenW).toFloat(), (ny * screenH).toFloat())

    private fun reportStatus() {
        sendJson(JSONObject().apply {
            put("type", "status")
            put("accessibility", InputAccessibilityService.isReady())
            put("overlay", Settings.canDrawOverlays(this@BridgeService))
        })
    }

    // ---------- 悬浮窗光标 ----------
    private fun ensureCursor() {
        if (cursorView != null) return
        if (!Settings.canDrawOverlays(this)) return
        wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val iv = ImageView(this).apply { setImageResource(R.drawable.ic_cursor) }
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        lp = WindowManager.LayoutParams(
            dp(28), dp(28), type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.TOP or Gravity.START }
        cursorView = iv
        wm?.addView(iv, lp)
    }

    private fun showCursorAt(nx: Double, ny: Double) {
        ensureCursor()
        moveCursor(nx, ny)
    }

    private fun moveCursor(nx: Double, ny: Double) {
        val v = cursorView ?: return
        val p = lp ?: return
        p.x = (nx * screenW).toInt()
        p.y = (ny * screenH).toInt()
        try { wm?.updateViewLayout(v, p) } catch (_: Exception) {}
    }

    private fun removeCursor() {
        val v = cursorView ?: return
        try { wm?.removeView(v) } catch (_: Exception) {}
        cursorView = null
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    // ---------- 前台通知 ----------
    private fun startForegroundNotice() {
        val chId = "bridge"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(chId, "跨屏协同", NotificationManager.IMPORTANCE_LOW)
            (getSystemService(NotificationManager::class.java)).createNotificationChannel(ch)
        }
        val n: Notification = Notification.Builder(this, chId)
            .setContentTitle("跨屏协同已就绪")
            .setContentText("等待 PC 通过 USB 连接…")
            .setSmallIcon(R.drawable.ic_cursor)
            .build()
        startForeground(1, n)
    }

    companion object {
        const val PORT = 5566
        @Volatile private var ref: BridgeService? = null

        fun onAccessibilityChanged(ready: Boolean) {
            BridgeState.accessibility.postValue(ready)
            ref?.reportStatus()
        }
    }
}
