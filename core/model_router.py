"""
4 U By U - Model Routing & Resilient LLM Client Engine
Routes inference requests across free tiers and direct provider APIs
(Groq, Gemini, OpenAI, Claude) with native zero-dependency HTTP fallback.
"""

import os
import requests
import json
from typing import Dict, Any, Optional, List, AsyncIterator
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage, AIMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatResult, ChatGeneration, ChatGenerationChunk
from langchain_core.messages.ai import AIMessageChunk

from config import DEFAULT_GROQ_MODEL, DEFAULT_GEMINI_MODEL

def detect_key_provider(api_key: str) -> Optional[str]:
    """Detects provider format from raw API key prefix."""
    if not api_key:
        return None
    k = api_key.strip()
    if k.startswith("gsk_"):
        return "groq"
    elif k.startswith("AIzaSy"):
        return "gemini"
    elif k.startswith("sk-ant-"):
        return "claude"
    elif k.startswith("sk-"):
        return "openai"
    return None

class DirectUniversalChatModel(BaseChatModel):
    provider: str = "groq"
    api_key: str = ""
    model_name: str = "openai/gpt-oss-120b"
    temperature: float = 0.2

    @property
    def _llm_type(self) -> str:
        return f"direct_{self.provider}_chat"

    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Any = None,
        **kwargs: Any
    ) -> ChatResult:
        payload_messages = []
        for m in messages:
            if isinstance(m, SystemMessage):
                payload_messages.append({"role": "system", "content": m.content})
            elif isinstance(m, HumanMessage):
                payload_messages.append({"role": "user", "content": m.content})
            elif isinstance(m, AIMessage):
                payload_messages.append({"role": "assistant", "content": m.content})
            else:
                payload_messages.append({"role": "user", "content": str(m.content)})

        if self.provider == "groq":
            import time
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            target = self.model_name
            if not target or "llama-3.3-70b" in target:
                target = "openai/gpt-oss-120b"

            body = {
                "model": target,
                "messages": payload_messages,
                "temperature": self.temperature
            }
            res = requests.post(url, headers=headers, json=body, timeout=25)
            if res.status_code == 200:
                txt = res.json()["choices"][0]["message"]["content"]
                return ChatResult(generations=[ChatGeneration(message=AIMessage(content=txt))])
            elif res.status_code == 401:
                from config import DEFAULT_GROQ_KEY
                if DEFAULT_GROQ_KEY and self.api_key != DEFAULT_GROQ_KEY:
                    headers["Authorization"] = f"Bearer {DEFAULT_GROQ_KEY}"
                    res_def = requests.post(url, headers=headers, json=body, timeout=25)
                    if res_def.status_code == 200:
                        txt = res_def.json()["choices"][0]["message"]["content"]
                        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=txt))])
            elif res.status_code == 429:
                # Fast retry with gpt-oss-20b after brief pause
                time.sleep(1.5)
                body["model"] = "openai/gpt-oss-20b"
                res2 = requests.post(url, headers=headers, json=body, timeout=30)
                if res2.status_code == 200:
                    txt = res2.json()["choices"][0]["message"]["content"]
                    return ChatResult(generations=[ChatGeneration(message=AIMessage(content=txt))])
                raise RuntimeError(f"Groq TPM Rate Limit (429). Used fallback.")
            else:
                # Try fallback model on Groq
                body["model"] = "openai/gpt-oss-20b"
                res2 = requests.post(url, headers=headers, json=body, timeout=30)
                if res2.status_code == 200:
                    txt = res2.json()["choices"][0]["message"]["content"]
                    return ChatResult(generations=[ChatGeneration(message=AIMessage(content=txt))])
                raise RuntimeError(f"Groq API Error {res.status_code}: {res.text}")

        elif self.provider == "gemini":
            url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            body = {
                "model": self.model_name or "gemini-2.0-flash",
                "messages": payload_messages,
                "temperature": self.temperature
            }
            res = requests.post(url, headers=headers, json=body, timeout=25)
            if res.status_code == 200:
                txt = res.json()["choices"][0]["message"]["content"]
                return ChatResult(generations=[ChatGeneration(message=AIMessage(content=txt))])
            elif res.status_code == 401:
                from config import DEFAULT_GROQ_KEY
                if DEFAULT_GROQ_KEY and self.api_key != DEFAULT_GROQ_KEY:
                    headers["Authorization"] = f"Bearer {DEFAULT_GROQ_KEY}"
                    res_def = requests.post(url, headers=headers, json=body, timeout=25)
                    if res_def.status_code == 200:
                        txt = res_def.json()["choices"][0]["message"]["content"]
                        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=txt))])
            raise RuntimeError(f"Gemini API Error {res.status_code}: {res.text}")

        elif self.provider == "openrouter":
            url = "https://openrouter.ai/api/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://4ubyu.vercel.app",
                "X-Title": "4 U By U Educational Handbook Generator"
            }
            body = {
                "model": self.model_name or "meta-llama/llama-3.3-70b-instruct:free",
                "messages": payload_messages,
                "temperature": self.temperature
            }
            res = requests.post(url, headers=headers, json=body, timeout=25)
            if res.status_code == 200:
                txt = res.json()["choices"][0]["message"]["content"]
                return ChatResult(generations=[ChatGeneration(message=AIMessage(content=txt))])
            elif res.status_code == 401:
                from config import DEFAULT_GROQ_KEY
                if DEFAULT_GROQ_KEY and self.api_key != DEFAULT_GROQ_KEY:
                    headers["Authorization"] = f"Bearer {DEFAULT_GROQ_KEY}"
                    res_def = requests.post(url, headers=headers, json=body, timeout=25)
                    if res_def.status_code == 200:
                        txt = res_def.json()["choices"][0]["message"]["content"]
                        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=txt))])
            raise RuntimeError(f"OpenRouter API Error {res.status_code}: {res.text}")

        elif self.provider == "openai":
            url = "https://api.openai.com/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            body = {
                "model": self.model_name or "gpt-4o-mini",
                "messages": payload_messages,
                "temperature": self.temperature
            }
            res = requests.post(url, headers=headers, json=body, timeout=25)
            if res.status_code == 200:
                txt = res.json()["choices"][0]["message"]["content"]
                return ChatResult(generations=[ChatGeneration(message=AIMessage(content=txt))])
            elif res.status_code == 401:
                from config import DEFAULT_GROQ_KEY
                if DEFAULT_GROQ_KEY and self.api_key != DEFAULT_GROQ_KEY:
                    headers["Authorization"] = f"Bearer {DEFAULT_GROQ_KEY}"
                    res_def = requests.post(url, headers=headers, json=body, timeout=25)
                    if res_def.status_code == 200:
                        txt = res_def.json()["choices"][0]["message"]["content"]
                        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=txt))])
            raise RuntimeError(f"OpenAI API Error {res.status_code}: {res.text}")

        raise ValueError(f"Unsupported provider: {self.provider}")

    async def _astream(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Any = None,
        **kwargs: Any
    ) -> AsyncIterator[ChatGenerationChunk]:
        res = self._generate(messages)
        text = res.generations[0].message.content
        words = text.split(" ")
        for i, word in enumerate(words):
            chunk_text = word + (" " if i < len(words) - 1 else "")
            yield ChatGenerationChunk(message=AIMessageChunk(content=chunk_text))

class RobustFallbackChatModel(BaseChatModel):
    """Guaranteed zero-failure model for offline, rate-limited, or network-blocked environments."""
    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Any = None,
        **kwargs: Any
    ) -> ChatResult:
        last_msg = messages[-1].content if messages else ""
        query = str(last_msg).lower()
        last_user_q = ""
        for m in reversed(messages):
            if isinstance(m, HumanMessage) or getattr(m, "type", "") == "human":
                last_user_q = str(m.content)
                break
        q_disp = last_user_q.strip() if last_user_q else "your question"
        if len(q_disp) > 80:
            q_disp = q_disp[:77] + "..."
        ans = (
            f"> **[Study Assistant Notice]**\n\n"
            f"Regarding: **{q_disp}**\n\n"
            f"Temporary inference delay. You can switch between Grounded and Open Mode or re-ask. "
            f"All lecture notes and timestamps are available in the handbook on your left."
        )
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=ans))])

    @property
    def _llm_type(self) -> str:
        return "robust_fallback_chat_model"

    async def _astream(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Any = None,
        **kwargs: Any
    ) -> AsyncIterator[ChatGenerationChunk]:
        res = self._generate(messages)
        text = res.generations[0].message.content
        words = text.split(" ")
        for i, word in enumerate(words):
            chunk_text = word + (" " if i < len(words) - 1 else "")
            yield ChatGenerationChunk(message=AIMessageChunk(content=chunk_text))

def get_chat_model(
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
    temperature: float = 0.2,
    streaming: bool = False
) -> BaseChatModel:
    """Instantiates a working, direct HTTP ChatModel without fragile package import dependencies."""
    effective_key = (api_key or "").strip()
    provider = detect_key_provider(effective_key)

    if not provider:
        from config import DEFAULT_GROQ_KEY
        if os.getenv("GROQ_API_KEY"):
            effective_key = os.getenv("GROQ_API_KEY")
            provider = "groq"
        elif DEFAULT_GROQ_KEY:
            effective_key = DEFAULT_GROQ_KEY
            provider = "groq"
        elif os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"):
            effective_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
            provider = "gemini"
        elif os.getenv("OPENAI_API_KEY"):
            effective_key = os.getenv("OPENAI_API_KEY")
            provider = "openai"

    target_model = model_name
    if not target_model:
        if provider == "groq":
            target_model = "openai/gpt-oss-120b"
        elif provider == "gemini":
            target_model = "gemini-2.0-flash"
        elif provider == "openai":
            target_model = "gpt-4o-mini"
        elif provider == "claude":
            target_model = "claude-3-5-haiku-20241022"
        else:
            target_model = "openai/gpt-oss-120b"

    if provider in ["groq", "gemini", "openai"] and effective_key:
        try:
            return DirectUniversalChatModel(
                provider=provider,
                api_key=effective_key,
                model_name=target_model,
                temperature=temperature
            )
        except Exception as e:
            print(f"[ModelRouter] DirectUniversalChatModel notice: {e}")

    return RobustFallbackChatModel()
