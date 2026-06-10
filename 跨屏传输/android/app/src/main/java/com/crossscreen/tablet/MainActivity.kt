package com.crossscreen.tablet

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import androidx.appcompat.app.AppCompatActivity
import com.crossscreen.tablet.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var b: ActivityMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)

        // 启动前台服务
        startForegroundService(Intent(this, BridgeService::class.java))

        b.btnAccessibility.setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        b.btnOverlay.setOnClickListener {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")))
        }

        BridgeState.connected.observe(this) { on ->
            b.statusDot.setBackgroundResource(if (on) R.drawable.dot_green else R.drawable.dot_grey)
            b.statusText.text = if (on) "PC 已连接" else "等待 USB 连接…"
        }
        BridgeState.accessibility.observe(this) { on ->
            b.btnAccessibility.alpha = if (on) 0.4f else 1f
            b.accessibilityHint.text = if (on) "✓ 无障碍服务已启用" else "⚠ 请开启无障碍服务"
        }
        // 初始刷新悬浮窗按钮状态
        refreshOverlayStatus()
    }

    override fun onResume() {
        super.onResume()
        refreshOverlayStatus()
        BridgeState.accessibility.value = InputAccessibilityService.isReady()
    }

    private fun refreshOverlayStatus() {
        val ok = Settings.canDrawOverlays(this)
        b.btnOverlay.alpha = if (ok) 0.4f else 1f
        b.overlayHint.text = if (ok) "✓ 悬浮窗权限已授予" else "⚠ 请授予悬浮窗权限"
    }
}
