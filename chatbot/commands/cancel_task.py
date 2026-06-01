"""
取消任务命令处理
"""
from task_api.client import TaskApiClient


class CancelTaskHandler:
    def __init__(self):
        self.api = TaskApiClient()

    async def handle(self, cmd, user_id: str, chat_id: str) -> str:
        """处理取消任务命令"""
        task_ref = cmd.task_id.strip()

        result = await self.api.cancel_task(task_ref)

        if result["success"]:
            return f"## 任务已取消\n> `{task_ref}`"
        else:
            return f"<font color=\"warning\">取消失败</font>\n> {result.get('message', '未知错误')}"
