"""
企业微信消息加解密 (WXBizMsgCrypt)
兼容官方加解密协议：AES-256-CBC + PKCS7 + SHA1 签名
"""
import base64
import hashlib
import random
import string
import struct
import time
from typing import Tuple
from Crypto.Cipher import AES


def pkcs7_pad(data: bytes, block_size: int = 32) -> bytes:
    """PKCS7 填充"""
    pad_len = block_size - len(data) % block_size
    return data + bytes([pad_len] * pad_len)


def pkcs7_unpad(data: bytes) -> bytes:
    """去除 PKCS7 填充"""
    pad_len = data[-1]
    if pad_len < 1 or pad_len > 32:
        raise ValueError("invalid pkcs7 padding")
    return data[:-pad_len]


class WXBizMsgCrypt:
    def __init__(self, token: str, encoding_aes_key: str, corp_id: str):
        self.token = token
        self.corp_id = corp_id
        # AESKey = Base64_Decode(EncodingAESKey + "=")
        self.aes_key = base64.b64decode(encoding_aes_key + "=")

    def _signature(self, timestamp: str, nonce: str, encrypt: str) -> str:
        """计算 SHA1 签名"""
        params = sorted([self.token, timestamp, nonce, encrypt])
        return hashlib.sha1("".join(params).encode()).hexdigest()

    def encrypt(self, text: str) -> Tuple[str, str]:
        """
        加密明文消息
        返回: (encrypted_msg, signature)
        """
        # 16 字节随机串 + 4 字节 msg_len(网络序) + msg + corp_id
        random_bytes = "".join(
            random.choices(string.ascii_letters + string.digits, k=16)
        ).encode()
        msg_bytes = text.encode("utf-8")
        msg_len = struct.pack("!I", len(msg_bytes))
        raw = random_bytes + msg_len + msg_bytes + self.corp_id.encode("utf-8")

        # AES-256-CBC 加密，IV 取 AESKey 前 16 字节
        cipher = AES.new(self.aes_key, AES.MODE_CBC, self.aes_key[:16])
        encrypted = cipher.encrypt(pkcs7_pad(raw))
        encrypt_msg = base64.b64encode(encrypted).decode()

        timestamp = str(int(time.time()))
        nonce = "".join(random.choices(string.digits, k=10))
        signature = self._signature(timestamp, nonce, encrypt_msg)

        return encrypt_msg, signature

    def decrypt(self, encrypt_msg: str, msg_signature: str,
                timestamp: str, nonce: str) -> str:
        """
        解密企业微信推送的加密消息
        返回: 明文 XML/JSON 字符串
        """
        # 1. 验证签名
        expected_sig = self._signature(timestamp, nonce, encrypt_msg)
        if expected_sig != msg_signature:
            raise ValueError(f"signature mismatch: expected {expected_sig}, got {msg_signature}")

        # 2. AES 解密
        cipher = AES.new(self.aes_key, AES.MODE_CBC, self.aes_key[:16])
        decrypted = cipher.decrypt(base64.b64decode(encrypt_msg))
        decrypted = pkcs7_unpad(decrypted)

        # 3. 提取内容: random(16) + msg_len(4) + msg + corp_id
        # msg_len 是大端序 4 字节整数
        msg_len = struct.unpack("!I", decrypted[16:20])[0]
        msg = decrypted[20:20 + msg_len].decode("utf-8")
        received_corp_id = decrypted[20 + msg_len:].decode("utf-8")

        if received_corp_id != self.corp_id:
            raise ValueError(f"corp_id mismatch: expected {self.corp_id}, got {received_corp_id}")

        return msg
