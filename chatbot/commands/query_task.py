"""
查询任务命令处理
"""
from config import USER_MAPPING
from task_api.client import TaskApiClient


class QueryTaskHandler:
    def __init__(self):
        self.api = TaskApiClient()

    def resolve_username(self, wecom_user_id: str) -> str:
        return USER_MAPPING.get(wecom_user_id, wecom_user_id)

    def _format_task_list(self, tasks, title, max_show=5):
        """格式化任务列表为 Markdown"""
        if not tasks:
            return f"## {title}\n> 暂无任务"

        lines = [f"## {title} ({len(tasks)} 个)"]
        for t in tasks[:max_show]:
            sid = str(t.get("id", ""))[:8]
            desc = (t.get("description") or "")[:30]
            status = t.get("status", "unknown")
            status_label = {
                "pending": "等待",
                "executing": "执行中",
                "finished": "已完成",
                "completed": "已完成",
                "failed": "已失败",
                "submitting": "提交中",
            }.get(status, status)

            lines.append(f"> **{desc}**`{sid}` <font color=\"info\">{status_label}</font>")

        if len(tasks) > max_show:
            lines.append(f"> ... 还有 {len(tasks) - max_show} 个任务")

        return "\n".join(lines)

    async def handle(self, cmd, user_id: str, chat_id: str) -> str:
        """查询我的任务"""
        creator = self.resolve_username(user_id)
        tasks = await self.api.get_all_tasks(creator=creator)

        # 按状态分组
        executing = [t for t in tasks if t.get("status") in ("executing", "processing", "running")]
        pending = [t for t in tasks if t.get("status") in ("pending", "submitting")]
        finished = [t for t in tasks if t.get("status") in ("finished", "completed")]
        failed = [t for t in tasks if t.get("status") in ("failed", "fail")]

        parts = []
        if executing:
            parts.append(self._format_task_list(executing, "执行中的任务"))
        if pending:
            parts.append(self._format_task_list(pending, "等待中的任务"))

        if not executing and not pending:
            # 没有进行中的任务，显示最近的
            recent = tasks[:5]
            parts.append(self._format_task_list(recent, "最近的任务"))

        if finished:
            parts.append(f"> 已完成 {len(finished)} 个 · 失败 {len(failed)} 个")

        return "\n".join(parts) if parts else "## 我的任务\n> 暂无任务"

    async def handle_status(self, chat_id: str) -> str:
        """查询机器人硬件状态"""
        try:
            status = await self.api.get_robot_status()
        except Exception as e:
            return f"<font color=\"warning\">查询状态失败</font>\n> {e}"

        battery = status.get("battery_percentage", 0)
        cpu = status.get("cpu_usage", 0)
        memory = status.get("memory_usage", 0)
        latency = status.get("network_latency", -1)
        pos = status.get("current_position", {})
        dist = status.get("daily_distance", 0)

        battery_color = "info" if battery > 20 else "warning"
        cpu_color = "info" if cpu < 80 else "warning"
        latency_str = f"{latency:.0f}ms" if latency >= 0 else "无数据"

        return (
            f"## 机器人状态\n"
            f">电量: <font color=\"{battery_color}\">{battery:.0f}%</font>\n"
            f">CPU: <font color=\"{cpu_color}\">{cpu:.1f}%</font>\n"
            f">内存: {memory:.1f}%\n"
            f">延迟: {latency_str}\n"
            f">今日里程: {dist:.2f}m\n"
            f">位置: X={pos.get('x', 0):.2f}, Y={pos.get('y', 0):.2f}"
        )
