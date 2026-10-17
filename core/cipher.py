"""
4 U By U - Encryption Vault (AES-128-CBC / Fernet)
Encrypts user-supplied LLM API keys before database persistence.
Keys are only decrypted into RAM at the moment of pipeline generation.
"""

import os
from typing import Optional
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

_fernet_instance: Optional[Fernet] = None

def get_fernet() -> Fernet:
    global _fernet_instance
    if _fernet_instance is None:
        key = os.getenv("FERNET_KEY")
        if not key:
            # Fallback or alert
            key = Fernet.generate_key().decode("utf-8")
        if isinstance(key, str):
            key = key.encode("utf-8")
        _fernet_instance = Fernet(key)
    return _fernet_instance

def encrypt_secret(plain_text: Optional[str]) -> Optional[str]:
    """Encrypts plaintext string to URL-safe base64 string."""
    if not plain_text or not plain_text.strip():
        return None
    f = get_fernet()
    encrypted_bytes = f.encrypt(plain_text.strip().encode("utf-8"))
    return encrypted_bytes.decode("utf-8")

def decrypt_secret(cipher_text: Optional[str]) -> Optional[str]:
    """Decrypts ciphertext string to plaintext string."""
    if not cipher_text or not cipher_text.strip():
        return None
    f = get_fernet()
    try:
        decrypted_bytes = f.decrypt(cipher_text.strip().encode("utf-8"))
        return decrypted_bytes.decode("utf-8")
    except Exception:
        return None

def mask_secret(secret: Optional[str]) -> str:
    """Returns a masked preview like 'gsk_...a1b2' or empty string."""
    if not secret:
        return ""
    s = secret.strip()
    if len(s) <= 8:
        return "••••••••"
    return f"{s[:4]}...{s[-4:]}"
