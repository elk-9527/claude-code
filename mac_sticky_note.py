#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Mac 风格便签 (Mac-Style Sticky Note)
------------------------------------
特点:
  * 仿 macOS 无边框窗口 + 红黄绿"交通灯"按钮
  * 窗口可自由拖动、右下角可拖拽缩放
  * 输入自动保存(防抖,不写无谓磁盘)
  * 多种便签配色一键切换
  * 支持开机自启(macOS / Windows / Linux)
  * 纯 Tkinter 标准库实现,空闲 CPU≈0%,内存十几 MB

运行:        python mac_sticky_note.py
开启自启:    python mac_sticky_note.py --autostart on
关闭自启:    python mac_sticky_note.py --autostart off
"""

import os
import sys
import json
import platform
import tkinter as tk
from tkinter import font as tkfont

# ---------------------------------------------------------------------------
# 常量与配置
# ---------------------------------------------------------------------------
APP_NAME = "MacStickyNote"
CONFIG_PATH = os.path.join(os.path.expanduser("~"), ".mac_sticky_note.json")
SYSTEM = platform.system()  # 'Darwin' / 'Windows' / 'Linux'

# 便签配色方案: (正文背景, 标题栏背景, 文字颜色)
PALETTES = [
    ("#FEF3A6", "#FBE789", "#3A3526"),  # 经典黄
    ("#FFD7E4", "#FFC2D6", "#4A2C38"),  # 粉
    ("#CDEFD0", "#B6E6BC", "#243B27"),  # 绿
    ("#CDE4FF", "#B6D6FF", "#22344A"),  # 蓝
    ("#E8E2F7", "#D9D0F0", "#352C4A"),  # 紫
    ("#2B2B2B", "#1E1E1E", "#E8E8E8"),  # 暗黑
]

# 交通灯颜色
DOT_RED = "#FF5F57"
DOT_YELLOW = "#FEBC2E"
DOT_GREEN = "#28C840"

DEFAULT_GEOMETRY = "320x340"
MIN_W, MIN_H = 220, 200


def pick_font_family():
    """按平台选择系统原生字体,获得最接近原生的观感。"""
    if SYSTEM == "Darwin":
        return "SF Pro Text"
    if SYSTEM == "Windows":
        return "Microsoft YaHei UI"
    return "Noto Sans CJK SC"


def resource_path(name):
    """返回资源文件的绝对路径,兼容 PyInstaller 打包(--add-data 解压到 _MEIPASS)。"""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, name)


# ---------------------------------------------------------------------------
# 配置读写
# ---------------------------------------------------------------------------
def load_config():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def save_config(cfg):
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# 开机自启(跨平台)
# ---------------------------------------------------------------------------
def _script_command():
    """返回启动本程序所需的可执行命令(尽量用无控制台的解释器)。

    返回 (exe, script):
      * 已打包(PyInstaller frozen):exe 为 exe 自身,script 为 None
        —— 不能用 __file__,它指向运行时临时解压目录,退出即失效。
      * 源码运行:exe 为解释器(Windows 优先 pythonw 避免黑框),script 为本脚本。
    """
    if getattr(sys, "frozen", False):
        return os.path.abspath(sys.executable), None

    script = os.path.abspath(__file__)
    if SYSTEM == "Windows":
        pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
        exe = pyw if os.path.exists(pyw) else sys.executable
    else:
        exe = sys.executable
    return exe, script


def enable_autostart():
    exe, script = _script_command()
    # script 为 None 表示已打包(exe 自启动),命令里只放 exe 一项。
    args = [exe] if script is None else [exe, script]
    try:
        if SYSTEM == "Darwin":
            plist_dir = os.path.expanduser("~/Library/LaunchAgents")
            os.makedirs(plist_dir, exist_ok=True)
            plist = os.path.join(plist_dir, f"com.user.{APP_NAME}.plist")
            arg_xml = "\n".join(f"        <string>{a}</string>" for a in args)
            with open(plist, "w", encoding="utf-8") as f:
                f.write(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.user.{APP_NAME}</string>
    <key>ProgramArguments</key>
    <array>
{arg_xml}
    </array>
    <key>RunAtLoad</key><true/>
</dict>
</plist>
""")
        elif SYSTEM == "Windows":
            startup = os.path.join(
                os.environ["APPDATA"],
                r"Microsoft\Windows\Start Menu\Programs\Startup",
            )
            os.makedirs(startup, exist_ok=True)
            tail = "" if script is None else f' "{script}"'
            with open(os.path.join(startup, f"{APP_NAME}.bat"), "w", encoding="utf-8") as f:
                f.write(f'@echo off\nstart "" "{exe}"{tail}\n')
        else:  # Linux (XDG autostart)
            autostart = os.path.expanduser("~/.config/autostart")
            os.makedirs(autostart, exist_ok=True)
            exec_line = exe if script is None else f"{exe} {script}"
            with open(os.path.join(autostart, f"{APP_NAME}.desktop"), "w", encoding="utf-8") as f:
                f.write(f"""[Desktop Entry]
Type=Application
Name={APP_NAME}
Exec={exec_line}
X-GNOME-Autostart-enabled=true
""")
        return True
    except Exception:
        return False


def disable_autostart():
    paths = {
        "Darwin": os.path.expanduser(f"~/Library/LaunchAgents/com.user.{APP_NAME}.plist"),
        "Windows": os.path.join(
            os.environ.get("APPDATA", ""),
            rf"Microsoft\Windows\Start Menu\Programs\Startup\{APP_NAME}.bat",
        ),
        "Linux": os.path.expanduser(f"~/.config/autostart/{APP_NAME}.desktop"),
    }
    try:
        p = paths.get(SYSTEM)
        if p and os.path.exists(p):
            os.remove(p)
        return True
    except OSError:
        return False


# ---------------------------------------------------------------------------
# 主应用
# ---------------------------------------------------------------------------
class StickyNote:
    def __init__(self):
        self.cfg = load_config()
        self.palette_idx = self.cfg.get("palette", 0) % len(PALETTES)
        self.autostart = self.cfg.get("autostart", False)
        self._save_after_id = None

        self.root = tk.Tk()
        self.root.title(APP_NAME)
        self.root.geometry(self.cfg.get("geometry", DEFAULT_GEOMETRY))
        self.root.minsize(MIN_W, MIN_H)
        self.root.overrideredirect(True)          # 去掉系统边框
        self.root.attributes("-topmost", self.cfg.get("topmost", False))

        # 窗口/任务栏图标(打包后从 _MEIPASS 读取,缺失则忽略)
        try:
            ico = resource_path("app.ico")
            if os.path.exists(ico):
                self.root.iconbitmap(ico)
        except Exception:
            pass

        fam = pick_font_family()
        self.body_font = tkfont.Font(family=fam, size=14)

        self._build_ui()
        self._apply_palette()

        # 恢复正文内容
        if self.cfg.get("text"):
            self.text.insert("1.0", self.cfg["text"])

        # 还原时重新隐藏系统边框(最小化用)
        self.root.bind("<Map>", self._on_map)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    # ---------- 界面搭建 ----------
    def _build_ui(self):
        self.container = tk.Frame(self.root, highlightthickness=1)
        self.container.pack(fill="both", expand=True)

        # 标题栏
        self.header = tk.Frame(self.container, height=38)
        self.header.pack(fill="x", side="top")
        self.header.pack_propagate(False)
        self.header.bind("<Button-1>", self._start_move)
        self.header.bind("<B1-Motion>", self._on_move)

        # 交通灯
        self.lights = tk.Canvas(self.header, width=70, height=38,
                                highlightthickness=0, bd=0)
        self.lights.pack(side="left", padx=(12, 0))
        r = 6
        cy = 19
        self._dot_red = self.lights.create_oval(4, cy - r, 4 + 2 * r, cy + r,
                                                fill=DOT_RED, outline="")
        self._dot_yel = self.lights.create_oval(26, cy - r, 26 + 2 * r, cy + r,
                                                 fill=DOT_YELLOW, outline="")
        self._dot_grn = self.lights.create_oval(48, cy - r, 48 + 2 * r, cy + r,
                                                 fill=DOT_GREEN, outline="")
        self.lights.tag_bind(self._dot_red, "<Button-1>", lambda e: self._on_close())
        self.lights.tag_bind(self._dot_yel, "<Button-1>", lambda e: self._minimize())
        self.lights.tag_bind(self._dot_grn, "<Button-1>", lambda e: self._toggle_topmost())

        # 右侧:配色切换
        self.palette_btn = tk.Label(self.header, text="🎨", cursor="hand2")
        self.palette_btn.pack(side="right", padx=(0, 12))
        self.palette_btn.bind("<Button-1>", lambda e: self._cycle_palette())

        # 正文
        self.text = tk.Text(self.container, wrap="word", relief="flat",
                            bd=0, font=self.body_font, undo=True,
                            padx=16, pady=10, insertwidth=2,
                            spacing1=2, spacing3=4)
        self.text.pack(fill="both", expand=True)
        self.text.bind("<<Modified>>", self._on_modified)

        # 右下角缩放手柄
        self.grip = tk.Canvas(self.container, width=16, height=16,
                              highlightthickness=0, bd=0, cursor="bottom_right_corner")
        self.grip.place(relx=1.0, rely=1.0, anchor="se")
        for off in (4, 8, 12):
            self.grip.create_line(16 - off, 16, 16, 16 - off)
        self.grip.bind("<Button-1>", self._start_resize)
        self.grip.bind("<B1-Motion>", self._on_resize)

        # 右键菜单(打包成 exe 后也能在 GUI 里开关自启)
        self.menu = tk.Menu(self.root, tearoff=0)
        self._autostart_var = tk.BooleanVar(value=self.autostart)
        self.menu.add_checkbutton(label="开机自启动", variable=self._autostart_var,
                                  command=self._toggle_autostart)
        self.menu.add_command(label="切换配色", command=self._cycle_palette)
        self.menu.add_separator()
        self.menu.add_command(label="关闭便签", command=self._on_close)
        for w in (self.header, self.lights, self.text):
            w.bind("<Button-3>", self._popup_menu)

    def _popup_menu(self, e):
        try:
            self.menu.tk_popup(e.x_root, e.y_root)
        finally:
            self.menu.grab_release()

    def _toggle_autostart(self):
        self.autostart = self._autostart_var.get()
        ok = enable_autostart() if self.autostart else disable_autostart()
        if not ok:  # 操作失败则回滚勾选状态
            self.autostart = not self.autostart
            self._autostart_var.set(self.autostart)
        self._schedule_save()

    # ---------- 配色 ----------
    def _apply_palette(self):
        bg, head, fg = PALETTES[self.palette_idx]
        self.container.configure(bg=bg, highlightbackground=head, highlightcolor=head)
        self.header.configure(bg=head)
        self.lights.configure(bg=head)
        self.palette_btn.configure(bg=head, fg=fg)
        self.text.configure(bg=bg, fg=fg, insertbackground=fg,
                            selectbackground=head, selectforeground=fg)
        self.grip.configure(bg=bg)
        self.grip.itemconfig("all", fill=fg)

    def _cycle_palette(self):
        self.palette_idx = (self.palette_idx + 1) % len(PALETTES)
        self._apply_palette()
        self._schedule_save()

    # ---------- 窗口拖动 ----------
    def _start_move(self, e):
        self._mx, self._my = e.x, e.y

    def _on_move(self, e):
        x = self.root.winfo_x() + (e.x - self._mx)
        y = self.root.winfo_y() + (e.y - self._my)
        self.root.geometry(f"+{x}+{y}")

    # ---------- 缩放 ----------
    def _start_resize(self, e):
        self._rw = self.root.winfo_width()
        self._rh = self.root.winfo_height()
        self._rx, self._ry = e.x_root, e.y_root

    def _on_resize(self, e):
        w = max(MIN_W, self._rw + (e.x_root - self._rx))
        h = max(MIN_H, self._rh + (e.y_root - self._ry))
        self.root.geometry(f"{w}x{h}")

    # ---------- 交通灯动作 ----------
    def _minimize(self):
        # 无边框窗口最小化需先恢复系统边框,<Map> 事件里再隐藏
        self.root.overrideredirect(False)
        self.root.iconify()

    def _on_map(self, _e):
        if self.root.state() == "normal":
            self.root.overrideredirect(True)

    def _toggle_topmost(self):
        new = not self.root.attributes("-topmost")
        self.root.attributes("-topmost", new)
        self.cfg["topmost"] = new
        self._schedule_save()

    # ---------- 自动保存(防抖) ----------
    def _on_modified(self, _e):
        # Text 的 Modified 标志需要复位才能再次触发
        self.text.edit_modified(False)
        self._schedule_save()

    def _schedule_save(self):
        if self._save_after_id:
            self.root.after_cancel(self._save_after_id)
        self._save_after_id = self.root.after(600, self._persist)

    def _persist(self):
        self._save_after_id = None
        self.cfg.update({
            "text": self.text.get("1.0", "end-1c"),
            "palette": self.palette_idx,
            "geometry": self.root.geometry(),
            "autostart": self.autostart,
        })
        save_config(self.cfg)

    # ---------- 关闭 ----------
    def _on_close(self):
        self._persist()
        self.root.destroy()

    def run(self):
        # 启动即同步一次自启状态
        if self.autostart:
            enable_autostart()
        self.root.mainloop()


if __name__ == "__main__":
    # 命令行开关自启:  python mac_sticky_note.py --autostart on|off
    if len(sys.argv) >= 3 and sys.argv[1] == "--autostart":
        cfg = load_config()
        if sys.argv[2] == "on":
            ok = enable_autostart()
            cfg["autostart"] = True
        else:
            ok = disable_autostart()
            cfg["autostart"] = False
        save_config(cfg)
        print("自启动已", "开启" if cfg["autostart"] else "关闭", "—",
              "成功" if ok else "失败")
        sys.exit(0)

    StickyNote().run()
