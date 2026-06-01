"""
企业微信群机器人配置 — 示例模板
复制为 config.py 并填入实际值
"""
# ========== 企业微信应用配置 ==========
# 从企业微信管理后台 -> 应用管理 -> 自建应用 获取
CORP_ID = "YOUR_CORP_ID"          # 企业 ID
AGENT_ID = "YOUR_AGENT_ID"        # 应用 AgentId
SECRET = "YOUR_SECRET"            # 应用 Secret
TOKEN = "YOUR_TOKEN"              # 回调 Token（自定义，3-32位）
ENCODING_AES_KEY = "YOUR_AES_KEY" # 回调 EncodingAESKey（43位）

# ========== 机器人/DB 服务器 API ==========
ROBOT_URL = "http://10.130.5.129:5000"
DB_URL = "http://localhost:18080"  # 同机部署，使用 localhost

# ========== 服务配置 ==========
HOST = "0.0.0.0"
PORT = 18888

# ========== 用户映射 ==========
# 企业微信 UserID -> 系统内 username
USER_MAPPING = {
    # "wecom_userid": "system_username",
}
