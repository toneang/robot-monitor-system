"""
任务状态监控
定时轮询 DB 中注册的任务状态，到达终态时通过企业微信推送通知到群
"""
import asyncio
import httpx
from config import DB_URL


class TaskStatusMonitor:
    _instance = None

    def __init__(self):
        self._tasks = {}  # task_id -> {chat_id, description}
        self._running = False
        self._wechat_client = None

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def set_wechat_client(self, client):
        """注入企业微信客户端，用于发送通知"""
        self._wechat_client = client

    def register(self, task_id: str, chat_id: str, description: str = ""):
        """注册一个待监控的任务"""
        self._tasks[task_id] = {
            "chat_id": chat_id,
            "description": description,
        }

    def unregister(self, task_id: str):
        """移除监控"""
        self._tasks.pop(task_id, None)

    async def _check_single_task(self, task_id):
        """检查单个任务状态"""
        try:
            async with httpx.AsyncClient(verify=False, timeout=10) as client:
                resp = await client.get(f"{DB_URL}/api/task/list")
                tasks = resp.json()
                if isinstance(tasks, dict):
                    tasks = tasks.get("data", [])
                for t in tasks:
                    if str(t.get("id")) == str(task_id):
                        return t
        except Exception:
            pass
        return None

    def _is_terminal(self, status: str) -> bool:
        status = str(status).lower()
        return status in ("completed", "finished", "finish", "failed", "fail")

    async def _poll_loop(self):
        """后台轮询循环"""
        while self._running:
            done_ids = []
            for task_id, info in list(self._tasks.items()):
                task = await self._check_single_task(task_id)
                if task is None:
                    continue

                status = str(task.get("status", "")).lower()
                if self._is_terminal(status):
                    # 终态，发送通知
                    done_ids.append(task_id)
                    if self._wechat_client:
                        try:
                            status_label = "完成" if status in ("completed", "finished", "finish") else "失败"
                            color = "info" if status_label == "完成" else "warning"
                            desc = info.get("description", task.get("description", ""))
                            sid = task_id[:8]
                            content = (
                                f"## 任务{status_label}\n"
                                f">描述: {desc}\n"
                                f">结果: <font color=\"{color}\">{status_label}</font>\n"
                                f">ID: `{sid}...`"
                            )
                            await self._wechat_client.send_markdown(
                                content, chat_id=info["chat_id"]
                            )
                        except Exception as e:
                            print(f"[TaskStatus] Failed to notify for {task_id}: {e}")

            for tid in done_ids:
                self.unregister(tid)

            await asyncio.sleep(5)

    def start(self):
        """启动后台监控"""
        if self._running:
            return
        self._running = True
        asyncio.ensure_future(self._poll_loop())

    def stop(self):
        """停止后台监控"""
        self._running = False
