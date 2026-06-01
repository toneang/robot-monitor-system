"""
封装调用现有任务系统的 REST API
"""
import uuid
import httpx
from config import ROBOT_URL, DB_URL


class TaskApiClient:
    def __init__(self, robot_url: str = ROBOT_URL, db_url: str = DB_URL):
        self.robot_url = robot_url.rstrip("/")
        self.db_url = db_url.rstrip("/")

    # ---------- 创建任务 ----------

    async def create_task(self, description: str, creator: str,
                          task_type: str = "custom",
                          location: str = "unspecified",
                          priority: str = "low",
                          execute_time: str = "",
                          use_memory: int = 0,
                          model: str = "vlm",
                          model_selection: str = "vlm",
                          display_type: str = "custom") -> dict:
        """创建任务：先发机器人，再持久化到 DB"""
        task_id = str(uuid.uuid4())
        payload = {
            "id": task_id,
            "type": task_type,
            "description": description,
            "location": location,
            "priority": priority,
            "execute_time": execute_time,
            "use_memory": use_memory,
            "model": model,
            "model_selection": model_selection,
            "display_type": display_type,
            "status": "submitting",
            "creator": creator,
        }

        async with httpx.AsyncClient(verify=False, timeout=30) as client:
            # 1. 发送到机器人
            resp = await client.post(
                f"{self.robot_url}/api/task/add",
                json=payload,
            )
            robot_result = resp.json()

            if robot_result.get("code") != 200:
                return {"success": False, "error": robot_result.get("message", "robot rejected"), "task_id": task_id}

            # 2. 持久化到 DB
            resp = await client.post(
                f"{self.db_url}/api/task/persist",
                json=payload,
            )
            db_result = resp.json()

            return {
                "success": db_result.get("code") == 200,
                "task_id": task_id,
                "payload": payload,
            }

    # ---------- 查询任务 ----------

    async def get_all_tasks(self, creator=""):
        """获取全部任务（可按创建者过滤）"""
        params = {}
        if creator:
            params["creator"] = creator

        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            resp = await client.get(
                f"{self.db_url}/api/task/list",
                params=params,
            )
            data = resp.json()
            if isinstance(data, list):
                return data
            return data.get("data", [])

    async def get_current_tasks(self):
        """获取正在执行的任务"""
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            resp = await client.get(f"{self.db_url}/api/task/current")
            data = resp.json()
            if isinstance(data, list):
                return data
            return data.get("data", [])

    async def get_pending_tasks(self):
        """获取等待中的任务"""
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            resp = await client.get(f"{self.db_url}/api/task/pending")
            data = resp.json()
            if isinstance(data, list):
                return data
            return data.get("data", [])

    async def get_task_status(self, task_id):
        """获取单个任务状态"""
        tasks = await self.get_all_tasks()
        for t in tasks:
            if str(t.get("id")) == str(task_id):
                return t
        return None

    # ---------- 控制/删除 ----------

    async def cancel_task(self, task_id: str) -> dict:
        """取消任务：先通知机器人，再从 DB 删除"""
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            # 删除机器人端
            try:
                await client.delete(f"{self.robot_url}/api/task/delete/{task_id}")
            except Exception:
                pass  # 机器人可能已经丢掉了这个任务

            # 删除 DB 端
            resp = await client.delete(f"{self.db_url}/api/task/delete/{task_id}")
            data = resp.json()
            return {
                "success": data.get("code") == 200,
                "message": data.get("message", ""),
            }

    # ---------- 机器人状态 ----------

    async def get_robot_status(self) -> dict:
        """获取机器人硬件状态"""
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            resp = await client.get(f"{self.robot_url}/api/status")
            return resp.json()
