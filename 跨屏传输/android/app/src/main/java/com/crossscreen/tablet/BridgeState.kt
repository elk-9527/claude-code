package com.crossscreen.tablet

import androidx.lifecycle.MutableLiveData

/** 跨组件共享的连接/权限状态,供 UI 观察 */
object BridgeState {
    val connected = MutableLiveData(false)
    val accessibility = MutableLiveData(false)
}
