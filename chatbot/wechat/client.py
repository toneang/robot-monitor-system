"""
企业微信 API 客户端
- 获取 access_token
- 发送群聊消息（文本 / Markdown）
"""
import time
import httpx
from config import CORP_ID, SECRET, AGENT_ID


class WeChatClient:
    def __init__(self):
        self._access_token = None
        self._token_expire_at: float = 0

    # ---------- access_token ----------

    async def get_access_token(self) -> str:
        """获取企业微信 access_token（带缓存）"""
        if self._access_token and time.time() < self._token_expire_at - 300:
            return self._access_token

        url = "https://qyapi.weixin.qq.com/cgi-bin/gettoken"
        async with httpx.AsyncClient(verify=False) as client:
            resp = await client.get(url, params={
                "corpid": CORP_ID,
                "corpsecret": SECRET,
            })
            data = resp.json()
            if data.get("errcode") != 0:
                raise RuntimeError(f"get access_token failed: {data}")

            self._access_token = data["access_token"]
            self._token_expire_at = time.time() + data.get("expires_in", 7200)
            return self._access_token

    # ---------- 发送消息 ----------

    async def _send_message(self, payload: dict) -> dict:
        """通用消息发送"""
        token = await self.get_access_token()
        url = f"https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token={token}"
        async with httpx.AsyncClient(verify=False) as client:
            resp = await client.post(url, json=payload)
            return resp.json()

    async def send_text(self, content, chat_id=None, user_id=None):
        """
        发送文本消息到群聊或私聊
        群聊: chat_id (群 ID)，私聊: user_id (成员 UserID)
        """
        payload = {
            "msgtype": "text",
            "agentid": int(AGENT_ID),
            "text": {"content": content},
        }
        if chat_id:
            payload["touser"] = chat_id
        elif user_id:
            payload["touser"] = user_id
        else:
            payload["touser"] = "@all"

        return await self._send_message(payload)

    async def send_markdown(self, content, chat_id=None, user_id=None):
        """
        发送 Markdown 消息到群聊或私聊
        企业微信支持的 Markdown 子集：标题、加粗、链接、引用、字体颜色
        """
        payload = {
            "msgtype": "markdown",
            "agentid": int(AGENT_ID),
            "markdown": {"content": content},
        }
        if chat_id:
            payload["touser"] = chat_id
        elif user_id:
            payload["touser"] = user_id
        else:
            payload["touser"] = "@all"

        return await self._send_message(payload)

    async def reply_task_created(self, chat_id: str, serial: int,
                                 task_id: str, description: str,
                                 status: str = "pending") -> dict:
        """快捷回复：任务创建成功"""
        content = (
            f"## 任务已创建\n"
            f">编号: <font color=\"info\">#{serial}</font>\n"
            f">描述: {description}\n"
            f">状态: <font color=\"warning\">等待执行</font>\n"
            f">ID: `{task_id[:8]}...`"
        )
        return await self.send_markdown(content, chat_id=chat_id)

    async def reply_error(self, chat_id: str, error_msg: str) -> dict:
        """快捷回复：错误"""
        content = f"<font color=\"warning\">操作失败</font>\n> {error_msg}"
        return await self.send_markdown(content, chat_id=chat_id)

    async def reply_task_status(self, chat_id: str, task_id: str,
                                status: str, description: str) -> dict:
        """快捷回复：任务状态更新通知"""
        status_emoji = {
            "completed": "完成",
            "finished": "完成",
            "failed": "失败",
            "fail": "失败",
        }
        end_label = status_emoji.get(status, status)
        color = "info" if end_label == "完成" else "warning"

        content = (
            f"## 任务{end_label}\n"
            f">描述: {description}\n"
            f">结果: <font color=\"{color}\">{end_label}</font>\n"
            f">ID: `{task_id[:8]}...`"
        )
        return await self.send_markdown(content, chat_id=chat_id)
