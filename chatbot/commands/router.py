"""
命令路由器：基于关键词 + 正则的命令分发与自然语言解析
支持的命令：
  创建任务: 帮/拿/取/送/去/提醒/告诉我/检查
  查询任务: 查询/查/我的任务/任务列表/当前任务
  取消任务: 取消/删除
  系统状态: 状态/机器人/怎么样
"""
import re
from dataclasses import dataclass, field
from commands.create_task import CreateTaskHandler
from commands.query_task import QueryTaskHandler
from commands.cancel_task import CancelTaskHandler


@dataclass
class Command:
    """解析后的命令"""
    intent: str           # "create" | "query" | "cancel" | "status" | "unknown"
    description: str = ""  # 任务描述
    location: str = ""     # 位置
    execute_time: str = "" # 执行时间
    task_id: str = ""     # 任务 ID（取消时用）
    raw: str = ""         # 原始消息


class CommandRouter:
    def __init__(self):
        self.create_handler = CreateTaskHandler()
        self.query_handler = QueryTaskHandler()
        self.cancel_handler = CancelTaskHandler()

    def parse(self, text: str) -> Command:
        """
        解析用户消息为 Command
        去除 @机器人 前缀后传入
        """
        text = text.strip()

        # ---- 查询命令 ----
        if re.search(r"(查|我的任务|任务列表|当前任务|进行中)", text):
            return Command(intent="query", raw=text)

        # ---- 取消命令 ----
        cancel_match = re.search(r"(?:取消|删除|撤[销回])\s*(?:任务)?\s*#?(\S+)", text)
        if cancel_match:
            return Command(intent="cancel", task_id=cancel_match.group(1), raw=text)

        # ---- 状态查询 ----
        if re.search(r"(状态|机器人.*怎么样|怎么样.*机器人|运行|硬件)", text):
            return Command(intent="status", raw=text)

        # ---- 创建任务（默认意图） ----
        # 提取位置: 去/到 + 位置词
        location = ""
        loc_match = re.search(r"(?:去|到|在)\s*(\d{3,4}[A-Za-z]?|[a-zA-Z]+\d+|[一-龥]{2,6}(?:室|区|间|厅|工位|座位|桌))", text)
        if loc_match:
            location = loc_match.group(1)

        # 提取时间: 下午3点 / 3pm / 半小时后 / 明天上午
        execute_time = ""
        time_match = re.search(
            r"(?:下午|上午|中午|晚上|明天|后天|今天)?\s*"
            r"(?:\d{1,2}[点时：:]\d{0,2}(?:分)?"
            r"|\d{1,2}[点时]"
            r"|\d{1,2}pm"
            r"|\d{1,2}am"
            r"|半[小个]时[之以]?后"
            r"|\d+分?钟[之以]?后)",
            text, re.IGNORECASE
        )
        if time_match:
            execute_time = time_match.group(0)

        # 去掉命令词，保留纯描述
        description = text
        # 去掉常见的前缀词
        description = re.sub(r"^(帮|帮我|请|麻烦|能不能|可以|可否)\s*", "", description)
        # 去掉 "提醒我"
        description = re.sub(r"提醒我\s*", "", description)
        # 去掉已提取的时间/位置（保留在字段中）
        if location:
            description = description.replace(f"去{location}", "").replace(f"到{location}", "")
        if execute_time:
            description = description.replace(execute_time, "")

        description = description.strip()
        if not description:
            description = text.strip()

        return Command(
            intent="create",
            description=description,
            location=location or "unspecified",
            execute_time=execute_time,
            raw=text,
        )

    async def execute(self, cmd: Command, user_id: str, chat_id: str) -> str:
        """
        执行命令，返回回复文本（Markdown 格式）
        """
        if cmd.intent == "create":
            return await self.create_handler.handle(cmd, user_id, chat_id)
        elif cmd.intent == "query":
            return await self.query_handler.handle(cmd, user_id, chat_id)
        elif cmd.intent == "cancel":
            return await self.cancel_handler.handle(cmd, user_id, chat_id)
        elif cmd.intent == "status":
            return await self.query_handler.handle_status(chat_id)
        else:
            return (
                "抱歉，我没理解你的意思。你可以试试：\n"
                "> **创建任务**：`帮我拿一瓶可乐`\n"
                "> **查询任务**：`查任务` / `我的任务`\n"
                "> **取消任务**：`取消 #任务编号`\n"
                "> **查看状态**：`机器人状态`"
            )
