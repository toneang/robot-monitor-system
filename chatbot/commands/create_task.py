"""
创建任务命令处理
"""
from config import USER_MAPPING
from task_api.client import TaskApiClient
from task_status import TaskStatusMonitor


class CreateTaskHandler:
    def __init__(self):
        self.api = TaskApiClient()

    def resolve_username(self, wecom_user_id: str) -> str:
        """企业微信 UserID -> 系统 username"""
        return USER_MAPPING.get(wecom_user_id, wecom_user_id)

    async def handle(self, cmd, user_id: str, chat_id: str) -> str:
        """处理创建任务命令"""
        creator = self.resolve_username(user_id)
        result = await self.api.create_task(
            description=cmd.description,
            creator=creator,
            location=cmd.location,
            execute_time=cmd.execute_time or "",
        )

        if not result["success"]:
            return f"<font color=\"warning\">任务创建失败</font>\n> {result.get('error', '未知错误')}"

        task_id = result["task_id"]
        desc = result["payload"]["description"]
        loc = result["payload"]["location"] or "未指定"

        # 注册到状态监控，任务终态时自动通知
        monitor = TaskStatusMonitor.get_instance()
        monitor.register(task_id, chat_id, desc)

        location_str = f"\n>位置: {loc}" if loc and loc != "unspecified" else ""
        execute_str = f"\n>时间: {cmd.execute_time}" if cmd.execute_time else ""

        return (
            f"## 任务已创建\n"
            f">描述: {desc}{location_str}{execute_str}\n"
            f">状态: <font color=\"warning\">等待执行</font>\n"
            f">ID: `{task_id[:16]}...`"
        )
