# app/agent/decision_explainer.py
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
import json
import os
import time
import math
from collections import defaultdict, deque

try:
    from google import genai
except Exception:
    genai = None


@dataclass(frozen=True)
class ExplainEvent:
    t_ms: int
    kind: str  # "switch" | "observe" (we mainly emit "switch")
    job_id: str
    policy: str
    node: Optional[str] = None
    reward: Optional[float] = None
    latency_ms: Optional[float] = None
    success: Optional[bool] = None
    context: Optional[Dict[str, float]] = None
    learner_snapshot: Optional[Dict[str, Any]] = None
    text: str = ""
    meta: Optional[Dict[str, Any]] = None


class DecisionExplainer:
    """
    Switch-only explainer:
      - track chosen policies
      - emit an explanation event ONLY when policy changes
      - optionally call Gemini to produce human explanation
    """

    def __init__(
        self,
        history: int = 500,
        *,
        gemini_model: str = "gemini-3.1-flash-lite-preview",
        enable_observe_events: bool = False,  # keep False unless you want observe spam
        max_context_keys: int = 8,
    ):
        self._events: deque[ExplainEvent] = deque(maxlen=history)

        self._policy_counts = defaultdict(int)
        self._policy_rewards_sum = defaultdict(float)
        self._policy_lat_sum = defaultdict(float)
        self._policy_obs = defaultdict(int)

        self._last_policy: Optional[str] = None
        self._switch_count = 0

        self.gemini_model = gemini_model
        self.enable_observe_events = bool(enable_observe_events)
        self.max_context_keys = int(max_context_keys)

    # ---------- public API ----------

    def record_choice(
        self,
        *,
        job_id: str,
        chosen_policy: str,
        chosen_node: str,
        context: Optional[Dict[str, float]],
        learner_stats: Dict[str, Any],
        learner_name: str,
    ) -> Optional[ExplainEvent]:
        """
        Returns an ExplainEvent ONLY if policy switched; otherwise returns None.
        """
        t_ms = int(time.time() * 1000)
        self._policy_counts[chosen_policy] += 1

        prev = self._last_policy
        switched = prev is not None and chosen_policy != prev
        self._last_policy = chosen_policy

        if not switched:
            return None

        self._switch_count += 1

        text, meta = self._explain_switch(
            from_policy=prev,
            to_policy=chosen_policy,
            context=context,
            learner_stats=learner_stats,
            learner_name=learner_name,
        )

        meta = {
            **(meta or {}),
            "from_policy": prev,
            "to_policy": chosen_policy,
            "switched": True,
            "switch_count": self._switch_count,
            "learner": learner_name,
        }

        ev = ExplainEvent(
            t_ms=t_ms,
            kind="switch",
            job_id=job_id,
            policy=chosen_policy,
            node=chosen_node,
            context=context,
            learner_snapshot=learner_stats,
            text=text,
            meta=meta,
        )
        self._events.append(ev)
        return ev

    def record_observation(
        self,
        *,
        job_id: str,
        policy: str,
        reward: float,
        latency_ms: float,
        success: bool,
        learner_stats_after: Dict[str, Any],
        learner_name: str,
    ) -> Optional[ExplainEvent]:
        """
        Optional: keep disabled by default to avoid spamming UI.
        """
        self._policy_obs[policy] += 1
        self._policy_rewards_sum[policy] += float(reward)
        self._policy_lat_sum[policy] += float(latency_ms)

        if not self.enable_observe_events:
            return None

        t_ms = int(time.time() * 1000)
        text = (
            f"Observed outcome for **{policy}**: "
            f"latency={_fmt(latency_ms)} ms, success={success}, reward={_fmt(reward)}."
        )
        meta = {
            "learner": learner_name,
            "policy": policy,
            "reward": float(reward),
            "latency_ms": float(latency_ms),
            "success": bool(success),
        }

        ev = ExplainEvent(
            t_ms=t_ms,
            kind="observe",
            job_id=job_id,
            policy=policy,
            reward=float(reward),
            latency_ms=float(latency_ms),
            success=bool(success),
            learner_snapshot=learner_stats_after,
            text=text,
            meta=meta,
        )
        self._events.append(ev)
        return ev

    def recent_events(self, limit: int = 50) -> List[Dict[str, Any]]:
        limit = int(limit)
        items = list(self._events)[-limit:]
        return [self._event_to_dict(e) for e in items]

    def summary(self) -> Dict[str, Any]:
        avg_reward = {
            p: (self._policy_rewards_sum[p] / self._policy_obs[p]) if self._policy_obs[p] else 0.0
            for p in self._policy_obs.keys()
        }
        avg_lat = {
            p: (self._policy_lat_sum[p] / self._policy_obs[p]) if self._policy_obs[p] else 0.0
            for p in self._policy_obs.keys()
        }
        return {
            "switch_count": self._switch_count,
            "last_policy": self._last_policy,
            "policy_counts": dict(self._policy_counts),
            "avg_reward_by_policy": avg_reward,
            "avg_latency_by_policy": avg_lat,
        }

    def timeseries(self) -> Dict[str, Any]:
        xs = [e.t_ms for e in self._events]
        ys = [1 if e.kind == "switch" else 0 for e in self._events]
        return {"t_ms": xs, "switch_event": ys}

    # ---------- internals ----------

    def _explain_switch(
        self,
        *,
        from_policy: Optional[str],
        to_policy: str,
        context: Optional[Dict[str, float]],
        learner_stats: Dict[str, Any],
        learner_name: str,
    ) -> Tuple[str, Dict[str, Any]]:
        text = self._gemini_switch_explanation(
            from_policy=from_policy,
            to_policy=to_policy,
            context=context,
            learner_stats=learner_stats,
            learner_name=learner_name,
        )
        if text:
            return text, {"provider": "gemini", "model": self.gemini_model}

        # Fallback deterministic explanation
        ctx = _compact_context(context, self.max_context_keys)
        arm_prev = learner_stats.get(from_policy) if from_policy else None
        arm_next = learner_stats.get(to_policy)

        prev_mean = _try_get_mean_reward(arm_prev)
        next_mean = _try_get_mean_reward(arm_next)

        reasons = []
        if next_mean is not None and prev_mean is not None:
            if next_mean > prev_mean:
                reasons.append(
                    f"the learner currently estimates **{to_policy}** has higher expected reward "
                    f"({next_mean:.3f}) than **{from_policy}** ({prev_mean:.3f})."
                )
            else:
                reasons.append(
                    f"the learner is exploring: **{to_policy}** does not look better by mean reward "
                    f"({next_mean:.3f} vs {prev_mean:.3f}), but bandits still try alternatives."
                )
        elif next_mean is not None:
            reasons.append(f"the learner has a current estimate for **{to_policy}** (≈{next_mean:.3f}).")
        else:
            reasons.append("the learner is exploring (not enough stats to justify purely by estimates).")

        if ctx and ctx != "(none)":
            reasons.append(f"Context snapshot: {ctx}")

        prev_s = from_policy or "(none yet)"
        text = (
            f"**Policy switch:** {prev_s} → **{to_policy}**.\n"
            f"Why: " + " ".join(reasons)
        )
        return text, {"provider": "fallback"}

    def _gemini_switch_explanation(
        self,
        *,
        from_policy: Optional[str],
        to_policy: str,
        context: Optional[Dict[str, float]],
        learner_stats: Dict[str, Any],
        learner_name: str,
    ) -> Optional[str]:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key or genai is None:
            return None

        prev = from_policy or "(none yet)"
        arm_prev = learner_stats.get(from_policy) if from_policy else None
        arm_next = learner_stats.get(to_policy)

        payload = {
            "preferred_policy": to_policy,
            "alternative_policy": prev,
            "learner": learner_name,
            "context": context or {},
            "prev_arm_stats": arm_prev,
            "next_arm_stats": arm_next,
        }

        prompt = (
            "You are explaining only ONE thing: why the currently preferred routing policy is favored.\n"
            "Write exactly 2-3 short sentences, maximum 70 words total.\n"
            "You must mention the preferred policy name and compare it directly against the alternative policy.\n"
            "Use only the evidence in the JSON. Do not invent numbers. Do not give recommendations.\n"
            "Be specific about estimated reward, sample count, exploration, or context when relevant.\n\n"
            "Simulation snapshot JSON:\n"
            f"{json.dumps(payload, ensure_ascii=False)}"
        )

        try:
            client = genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model=self.gemini_model,
                contents=prompt,
            )
            text = getattr(response, "text", None)
            if isinstance(text, str) and text.strip():
                return text.strip()
            return None
        except Exception:
            return None

    def _event_to_dict(self, e: ExplainEvent) -> Dict[str, Any]:
        return {
            "t_ms": e.t_ms,
            "kind": e.kind,
            "job_id": e.job_id,
            "policy": e.policy,
            "node": e.node,
            "reward": e.reward,
            "latency_ms": e.latency_ms,
            "success": e.success,
            "context": e.context,
            "learner_snapshot": e.learner_snapshot,
            "text": e.text,
            "meta": e.meta,
        }


def _fmt(x: Any) -> str:
    if x is None:
        return "?"
    try:
        xf = float(x)
        if math.isnan(xf) or math.isinf(xf):
            return "?"
        if abs(xf) >= 100:
            return f"{xf:.1f}"
        return f"{xf:.3f}"
    except Exception:
        return str(x)


def _compact_context(ctx: Optional[Dict[str, float]], k: int) -> str:
    if not ctx:
        return "(none)"
    items = sorted(ctx.items(), key=lambda kv: kv[0])[: max(1, k)]
    return ", ".join([f"{a}={_fmt(b)}" for a, b in items])


def _try_get_mean_reward(arm_stats: Any) -> Optional[float]:
    if not isinstance(arm_stats, dict):
        return None
    for key in ("mean_reward", "Q", "mean", "mean_window"):
        v = arm_stats.get(key)
        if isinstance(v, (int, float)) and math.isfinite(float(v)):
            return float(v)
    return None