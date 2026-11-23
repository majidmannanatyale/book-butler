"""Model wiring + token accounting.

Portkey (course key) is tried first; if it errors, PydanticAI's FallbackModel
retries the same request on OpenAI directly (OPENAI_API_KEY), same model.
gpt-6-luna is used everywhere (course rule).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache

from openai import AsyncOpenAI
from pydantic_ai.models import Model
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.openai import OpenAIResponsesModel
from pydantic_ai.providers.openai import OpenAIProvider

from config import MODEL_NAME, PORTKEY_BASE_URL, price_of


def _portkey_model() -> Model | None:
    key = os.getenv("PORTKEY_API_KEY", "").strip()
    if not key:
        return None
    client = AsyncOpenAI(api_key=key, base_url=PORTKEY_BASE_URL,
                         default_headers={"x-portkey-provider": "openai"}, max_retries=1, timeout=60)
    return OpenAIResponsesModel(MODEL_NAME, provider=OpenAIProvider(openai_client=client))


def _openai_model() -> Model | None:
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if not key:
        return None
    client = AsyncOpenAI(api_key=key, max_retries=1, timeout=60)
    return OpenAIResponsesModel(MODEL_NAME, provider=OpenAIProvider(openai_client=client))


@lru_cache(maxsize=1)
def build_model() -> Model:
    models = [m for m in (_portkey_model(), _openai_model()) if m is not None]
    if not models:
        raise RuntimeError("No API key found. Put PORTKEY_API_KEY (or OPENAI_API_KEY) in .env "
                           "in this folder or the folder above.")
    return models[0] if len(models) == 1 else FallbackModel(*models)


def providers_available() -> list[str]:
    out = []
    if os.getenv("PORTKEY_API_KEY", "").strip():
        out.append("portkey")
    if os.getenv("OPENAI_API_KEY", "").strip():
        out.append("openai")
    return out


@dataclass
class Meter:
    """Sums usage across every agent call in one request."""
    model: str = MODEL_NAME
    input_tokens: int = 0          # includes cached tokens (OpenAI convention)
    cached_tokens: int = 0
    cache_write_tokens: int = 0
    output_tokens: int = 0
    requests: int = 0
    by_agent: dict[str, dict] = field(default_factory=dict)

    def add(self, agent: str, usage) -> None:
        u = {
            "input_tokens": usage.input_tokens or 0,
            "cached_tokens": usage.cache_read_tokens or 0,
            "cache_write_tokens": usage.cache_write_tokens or 0,
            "output_tokens": usage.output_tokens or 0,
            "requests": usage.requests or 0,
        }
        self.input_tokens += u["input_tokens"]
        self.cached_tokens += u["cached_tokens"]
        self.cache_write_tokens += u["cache_write_tokens"]
        self.output_tokens += u["output_tokens"]
        self.requests += u["requests"]
        prev = self.by_agent.get(agent)
        if prev:
            for k, v in u.items():
                prev[k] += v
        else:
            self.by_agent[agent] = u

    @property
    def cost_usd(self) -> float:
        p = price_of(self.model)
        fresh = max(self.input_tokens - self.cached_tokens - self.cache_write_tokens, 0)
        return (fresh * p["input"] + self.cached_tokens * p["cached"]
                + self.cache_write_tokens * p["cache_write"] + self.output_tokens * p["output"]) / 1_000_000

    def as_dict(self) -> dict:
        return {
            "model": self.model,
            "input_tokens": self.input_tokens,
            "cached_tokens": self.cached_tokens,
            "cache_write_tokens": self.cache_write_tokens,
            "output_tokens": self.output_tokens,
            "requests": self.requests,
            "cost_usd": round(self.cost_usd, 6),
            "by_agent": self.by_agent,
        }
