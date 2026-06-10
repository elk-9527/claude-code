# 跨屏协同通信协议 v1

PC 与平板之间通过 **USB → adb forward → TCP** 建立的隧道通信。

- 链路:`PC(Electron) ⇄ localhost:port ⇄ [adb forward / USB] ⇄ 平板:5566(APK 内 TCP 服务)`
- 编码:每条消息为一行 **UTF-8 JSON**,以 `\n` 结尾(换行分隔的 JSON 流,NDJSON)
- 坐标:统一使用 **归一化坐标** `x, y ∈ [0,1]`,与具体分辨率无关,由接收端乘以自身屏幕尺寸

## PC → 平板(控制指令)

| type     | 字段                                  | 说明                       |
|----------|---------------------------------------|----------------------------|
| `hello`  | `{ name, version }`                   | 握手,PC 自报身份           |
| `enter`  | `{ x, y }`                            | 鼠标穿越进入平板,初始光标位置 |
| `leave`  | `{}`                                  | 鼠标退回 PC,隐藏平板光标   |
| `cursor` | `{ x, y }`                            | 移动虚拟光标(归一化)      |
| `tap`    | `{ x, y }`                            | 在某点单击                 |
| `longpress` | `{ x, y }`                         | 长按                       |
| `swipe`  | `{ x1, y1, x2, y2, duration }`        | 滑动,duration 毫秒        |
| `text`   | `{ value }`                           | 输入一段文本               |
| `key`    | `{ code }`                            | 特殊按键,见下方 keycode    |
| `ping`   | `{ t }`                               | 心跳,t 为时间戳            |

### key code(特殊键)
`BACK` 返回 / `HOME` 主页 / `RECENTS` 多任务 / `ENTER` 回车 / `DEL` 退格 / `TAB`

## 平板 → PC(状态回报)

| type      | 字段                          | 说明                         |
|-----------|-------------------------------|------------------------------|
| `welcome` | `{ name, model, w, h }`       | 握手应答,上报型号与屏幕尺寸  |
| `screen`  | `{ w, h }`                    | 屏幕尺寸变化(旋转等)        |
| `status`  | `{ accessibility, overlay }`  | 无障碍/悬浮窗权限是否已授权   |
| `pong`    | `{ t }`                       | 心跳应答                     |

## 连接流程
1. 平板 APK 启动 → 监听 `0.0.0.0:5566`,等待无障碍服务 + 悬浮窗权限
2. PC 端 `adb forward tcp:<本地随机端口> tcp:5566` 建立 USB 隧道
3. PC 连接本地端口 → 发送 `hello` → 平板回 `welcome`(含屏幕尺寸)
4. 鼠标移到 PC 屏幕右边缘 → PC 发 `enter` → 进入平板控制
5. 鼠标移动/点击/打字 → PC 发 `cursor`/`tap`/`text` → 平板无障碍服务执行
6. 鼠标回到左边缘 → PC 发 `leave` → 退回 PC
