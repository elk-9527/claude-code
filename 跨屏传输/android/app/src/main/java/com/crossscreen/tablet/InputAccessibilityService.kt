package com.crossscreen.tablet

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * 无障碍服务:真正执行输入注入。
 * - tap / longpress / swipe 通过 dispatchGesture
 * - text 通过给当前聚焦的可编辑节点 ACTION_SET_TEXT
 * - BACK/HOME/RECENTS 通过 performGlobalAction
 *
 * 通过静态引用暴露给 BridgeService 调用。
 */
class InputAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        BridgeService.onAccessibilityChanged(true)
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        instance = null
        BridgeService.onAccessibilityChanged(false)
        return super.onUnbind(intent)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) { /* 不需要监听 */ }
    override fun onInterrupt() {}

    // ---- 供 BridgeService 调用的注入方法(像素坐标) ----

    fun tap(x: Float, y: Float) {
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 50)
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    fun longPress(x: Float, y: Float) {
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 650)
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    fun swipe(x1: Float, y1: Float, x2: Float, y2: Float, duration: Long) {
        val path = Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
        val d = duration.coerceIn(50, 1200)
        val stroke = GestureDescription.StrokeDescription(path, 0, d)
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    fun globalAction(code: String) {
        val action = when (code) {
            "BACK" -> GLOBAL_ACTION_BACK
            "HOME" -> GLOBAL_ACTION_HOME
            "RECENTS" -> GLOBAL_ACTION_RECENTS
            else -> return
        }
        performGlobalAction(action)
    }

    /** 给当前聚焦的可编辑框追加文本;找不到聚焦框则忽略。 */
    fun inputText(value: String) {
        val root = rootInActiveWindow ?: return
        val focused = findFocusedEditable(root) ?: return
        val existing = focused.text?.toString() ?: ""
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, existing + value)
        }
        focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    /** 退格:删掉聚焦框最后一个字符 */
    fun backspace() {
        val root = rootInActiveWindow ?: return
        val focused = findFocusedEditable(root) ?: return
        val existing = focused.text?.toString() ?: ""
        if (existing.isEmpty()) return
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, existing.dropLast(1))
        }
        focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    private fun findFocusedEditable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (node.isFocused && node.isEditable) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val r = findFocusedEditable(child)
            if (r != null) return r
        }
        return null
    }

    companion object {
        @Volatile var instance: InputAccessibilityService? = null
        fun isReady() = instance != null
    }
}
