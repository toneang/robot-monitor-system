"""
企业微信群机器人 — FastAPI 入口
接收企业微信回调消息，解密、路由到对应命令，加密回复
"""
import json
import logging
import xml.etree.ElementTree as ET
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, Request, Response
from fastapi.responses import PlainTextResponse

from config import TOKEN, ENCODING_AES_KEY, CORP_ID, HOST, PORT
from wechat.crypto import WXBizMsgCrypt
from wechat.client import WeChatClient
from commands.router import CommandRouter
from task_status import TaskStatusMonitor

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("chatbot")

_crypto = None
_wechat_client = None
_router = None
_monitor = None


def get_crypto():
    global _crypto
    if _crypto is None:
        _crypto = WXBizMsgCrypt(TOKEN, ENCODING_AES_KEY, CORP_ID)
    return _crypto


def get_wechat_client():
    global _wechat_client
    if _wechat_client is None:
        _wechat_client = WeChatClient()
    return _wechat_client


def get_router():
    global _router
    if _router is None:
        _router = CommandRouter()
    return _router


def get_monitor():
    global _monitor
    if _monitor is None:
        _monitor = TaskStatusMonitor.get_instance()
    return _monitor


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动/关闭时的生命周期管理"""
    monitor = get_monitor()
    monitor.set_wechat_client(get_wechat_client())
    monitor.start()
    logger.info("Chatbot started, task status monitor running")
    yield
    get_monitor().stop()
    logger.info("Chatbot stopped")


app = FastAPI(lifespan=lifespan, title="Robot Task Chatbot")


# ==================== 企业微信回调 ====================


@app.get("/callback")
async def verify_url(
    msg_signature: str = Query(..., alias="msg_signature"),
    timestamp: str = Query(...),
    nonce: str = Query(...),
    echostr: str = Query(...),
):
    """
    企业微信回调 URL 验证（GET 请求）
    解密 echostr 并返回明文
    """
    try:
        plain = get_crypto().decrypt(echostr, msg_signature, timestamp, nonce)
        logger.info("URL verification succeeded")
        return Response(content=plain, media_type="text/plain")
    except Exception as e:
        logger.error(f"URL verification failed: {e}")
        return PlainTextResponse("verification failed", status_code=403)


@app.post("/callback")
async def receive_message(
    request: Request,
    msg_signature: str = Query(..., alias="msg_signature"),
    timestamp: str = Query(...),
    nonce: str = Query(...),
):
    """
    接收企业微信推送的消息（POST 请求）
    1. 读取加密 XML body
    2. 解密得到明文
    3. 提取消息内容 → 命令路由 → 执行 → 回复
    """
    # 1. 读取并解密
    body = await request.body()
    body_str = body.decode("utf-8")

    try:
        root = ET.fromstring(body_str)
        encrypt_elem = root.find("Encrypt")
        encrypt_text = encrypt_elem.text if encrypt_elem is not None else body_str
    except ET.ParseError:
        encrypt_text = body_str

    try:
        plain = get_crypto().decrypt(encrypt_text, msg_signature, timestamp, nonce)
    except Exception as e:
        logger.error(f"Decrypt failed: {e}")
        # 尝试当作明文 JSON 处理（某些场景下企业微信可能发未加密消息）
        plain = body_str

    logger.info(f"Received message: {plain[:200]}")

    # 2. 提取消息字段
    msg_data = parse_message(plain)
    if msg_data is None:
        logger.warning("Failed to parse message, ignoring")
        return PlainTextResponse("", status_code=200)

    from_user = msg_data.get("FromUserName", "")
    content = msg_data.get("Content", "")
    # 群聊消息的 ChatId 可能在不同字段
    chat_id = msg_data.get("ChatId", "") or msg_data.get("FromUserName", "")

    # 去除 @机器人 前缀
    content = content.strip()
    # 企业微信 @机器人 格式可能是 "@name text" 或 "text @name"
    content = content.split("@")[0].strip() if "@" in content else content

    if not content:
        return PlainTextResponse("", status_code=200)

    # 3. 命令路由
    cmd = get_router().parse(content)
    reply_text = await get_router().execute(cmd, from_user, chat_id)

    # 4. 回复消息（通过主动消息推送，而非回调返回值）
    try:
        # 优先发到群聊
        target_chat = chat_id if chat_id else from_user
        await get_wechat_client().send_markdown(reply_text, chat_id=target_chat)
    except Exception as e:
        logger.error(f"Failed to send reply: {e}")

    # 企业微信要求返回空字符串表示已处理
    return PlainTextResponse("", status_code=200)


def parse_message(plain):
    """
    解析明文消息，支持 XML 和 JSON 两种格式
    返回 dict 或 None
    """
    # 尝试 JSON
    try:
        data = json.loads(plain)
        return data
    except (json.JSONDecodeError, TypeError):
        pass

    # 尝试 XML
    try:
        root = ET.fromstring(plain)
        result = {}
        for child in root:
            result[child.tag] = child.text or ""
        return result
    except ET.ParseError:
        pass

    return None


# ==================== 健康检查 ====================


@app.get("/health")
async def health():
    return {"status": "ok", "monitored_tasks": len(get_monitor()._tasks)}


# ==================== 启动入口 ====================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False, log_level="info")
