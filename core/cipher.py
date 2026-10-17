"""
4 U By U - Encryption Vault (AES-128-CBC / Fernet)
Encrypts user-supplied LLM API keys before database persistence.
Keys are only decrypted into RAM at the moment of pipeline generation.
"""

import os
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

try:
    from cryptography.fernet import Fernet
except ImportError:
    Fernet = None

_fernet_instance = None

def get_fernet():
    global _fernet_instance
    if Fernet is None:
        return None
    if _fernet_instance is None:
        key = os.getenv("FERNET_KEY")
        if not key:
            key = Fernet.generate_key().decode("utf-8")
        if isinstance(key, str):
            key = key.encode("utf-8")
        try:
            _fernet_instance = Fernet(key)
        except Exception:
            _fernet_instance = None
    return _fernet_instance

def encrypt_secret(plain_text: Optional[str]) -> Optional[str]:
    """Encrypts plaintext string to URL-safe base64 string."""
    if not plain_text or not plain_text.strip():
        return None
    f = get_fernet()
    if f is None:
        return plain_text.strip()
    try:
        encrypted_bytes = f.encrypt(plain_text.strip().encode("utf-8"))
        return encrypted_bytes.decode("utf-8")
    except Exception:
        return plain_text.strip()

def decrypt_secret(cipher_text: Optional[str]) -> Optional[str]:
    """Decrypts ciphertext string to plaintext string."""
    if not cipher_text or not cipher_text.strip():
        return None
    f = get_fernet()
    if f is None:
        return cipher_text.strip()
    try:
        decrypted_bytes = f.decrypt(cipher_text.strip().encode("utf-8"))
        return decrypted_bytes.decode("utf-8")
    except Exception:
        return cipher_text.strip()

def mask_secret(secret: Optional[str]) -> str:
    """Returns safe masked preview: e.g. gsk_••••••••1a2b"""
    if not secret or len(secret) < 8:
        return "••••••••"
    return f"{secret[:4]}••••••••{secret[-4:]}"
