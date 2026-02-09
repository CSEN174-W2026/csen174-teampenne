# Learning method for the agent

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Protocol, Any
import math
import random
from collections import deque

class Learner(Protocol):
    name: str

    # arms: choice you can pick from ; context: optional extra information about the system state
    def choose_arm(self, arms: List[str], context: Optional[Dict[str, Any]] = None) -> str:
        ...

    # Learning Step
    def update(self, arm: str, reward: float, context: Optional[Dict[str, Any]] = None) -> None:
        ...

    # Exposes internal state for debugging and analysis
    def stats(self) -> Dict[str, Any]:
        ... 


"""-----Helper/Stats Classes-----"""

# Online mean/variance calculator using Welford's algorithm for numerical stability.
# Stores statistics incrementally without keeping all samples
class MeanVar:
    n: int = 0
    mean: float = 0.0
    m2: float = 0.0

    # Add a new sample and update mean/variance
    def add(self, x: float) -> None:
        self.n += 1
        d = x - self.mean
        self.mean += d / self.n
        d2 = x - self.mean
        self.m2 += d * d2

    @property
    def var(self) -> float:
        if self.n < 2:
            return 1.0
        return max(self.m2 / (self.n - 1), 1e-9)

    @property
    def std(self) -> float:
        return math.sqrt(self.var)
    

# Make sure the arm has state
# store: dictionary to hold arm states (counts, MeanVar, etc...)
# arms: list of arms to ensure are in the store
# factory: function to create a new state for an arm if it doesn't exist
def _ensure_arms(store: Dict[str, Any], arms: List[str], factory):
    for a in arms:
        if a not in store:
            store[a] = factory()

# Return the item with the highest score according to score_fn
def _argmax(items: List[str], score_fn) -> str:
    best = items[0]
    best_score = score_fn(best)
    for item in items[1:]:
        score = score_fn(item)
        if score > best_score:
            best = item
            best_score = score
    return best

# Pick a random arm
def _uniform_choice(rng: random.Random, arms: List[str]) -> str:
    return arms[rng.randrange(len(arms))]



class SampleAverageBandit:
    name = "SampleAverageBandit"
    
    def __init__ (self, seed: Optional[int] = None):
        self.random = random.Random(seed)
        self._q: Dict[str, float] = {}  # Estimated value of each arm - average reward per arm
        self._n: Dict[str, int] = {}    # Count of times each arm was chosen
    
    def choose_arm(self, arms: List[str], context: Optional[Dict[str, float]] = None) -> str:
        if not arms:
            raise ValueError("No arms provided")

        # Try to explore untried arms first
        for arm in arms:
            if self._n.get(arm,0) == 0:
                return arm
        
        def score_fn(a: str) -> float:
            return self._q.get(a,0.0)
            
        # Otherwise, exploit the best known arm
        return _argmax(arms, score_fn)

    def update(self, arm: str, reward: float, context: Optional[Dict[str, float]] = None) -> None:
        r = float(reward)
        n = self._n.get(arm, 0) + 1
        q = self._q.get(arm, 0.0)
        q = q + (1.0/n) * (r - q)  # Incremental update to mean
        self._n[arm] = n
        self._q[arm] = q

    def stats(self) -> Dict[str, dict]:
        return {a: {"n": self._n.get(a, 0), "Q": self._q.get(a, 0.0)} for a in self._q.keys()}
    

class EMABandit:
    name ="ema"

    def __init__(self, alpha: float = 0.1, epsilon: float = 0.1, seed: Optional[int] = None):
        self.alpha = float(alpha)
        self.epsilon = float(epsilon)
        self.rng = random.Random(seed)
        self._q: Dict[str, float] = {}  # Estimated value of each arm - exponentially weighted average reward
        self._n: Dict[str, int] = {}    # Count of times each arm was chosen
    
    def choose_arm(self, arms: List[str], context: Optional[Dict[str,float]]=None) -> str:
        if not arms:
            raise ValueError("No arms provided")
        
        # Exploration
        if self.rng.random() < self.epsilon:
            return _uniform_choice(self.rng, arms)
        
        # Ensure each arm has initial state
        for a in arms:
            self._q.setdefault(a, 0.0)
            self._n.setdefault(a, 0)
        
        # Greedy exploitation
        return _argmax(arms, lambda a: self._q.get(a, 0.0))
    
    def update(self, arm: str, reward: float, context: Optional[Dict]) -> None:
        r = float(reward)
        self._n[arm] = self._n.get(arm, 0) + 1
        q = self._q.get(arm, 0.0)
        q = q + self.alpha * (r-q) # Exponential moving average update
        self._q[arm] = q
    
    def stats(self) -> Dict[str, dict]:
        return {a: {"n": self._n.get(a, 0), "Q": self._q.get(a, 0.0)} for a in self._q.keys()}


class UCB1Bandit:
    name = "ucb1"

    def __init__(self, c: float = 2.0):
        self.c: float = c
        self._q: Dict[str, float] = {}
        self._n: Dict[str,int] = {}
        self._t: int = 0 # total number of times any arm has been chosen -> Total number of decisions made across all arms

    def choose_arm(self, arms: List[str], context: Optional[Dict] = None) -> str:
        if not arms:
            raise ValueError("No arms provided")

        # Try each arm at least once
        for arm in arms:
            if self._n.get(arm, 0) == 0:
                return arm
            
        self._t += 1
        t = sum(self._n.get(a,0) for a in arms)

        def score_fn(a: str) -> float:
            q = self._q.get(a,0.0)
            n = self._n.get(a,1) # Avoid division by zero, but should never be zero here due to above check
            bonus = self.c * math.sqrt(math.log(t)/n)
            return q + bonus

        return _argmax(arms, score_fn)
    
    def update(self, arm: str, reward: float, context: Optional[Dict[str,float]]) -> None:
        r = float(reward)
        n = self._n.get(arm, 0) + 1
        q = self._q.get(arm, 0.0)
        q = q + (1.0/n) * (r-q)  # Incremental update to mean
        self._n[arm] = n
        self._q[arm] = q
    
    def stats(self) -> Dict[str, dict]:
        return {a: {"n": self._n.get(a, 0), "Q": self._q.get(a, 0.0)} for a in self._q.keys()}
    

class ThompsonGaussianBandit:
    name = "thompson_gaussian"

    def __init__(self, seed: Optional[int] = None):
        self.rng = random.Random(seed)
        self._mv: Dict[str, MeanVar] = {} # Store mean/variance for each arm to model reward distribution as Gaussian

    def choose_arm(self, arms: List[str], context: Optional[Dict] = None) -> str:
        if not arms:
            raise ValueError("No arms provided")
        _ensure_arms(self._mv, arms, MeanVar)

        def sample(a:str) -> float:
            s = self._mv[a]
            if s.n == 0:
                return float('inf')  # Encourage trying untried arms
            
            sigma = s.std / math.sqrt(s.n + 1)  # Uncertainty decreases with more samples
            return self.rng.gauss(s.mean, sigma)
        
        return _argmax(arms, sample)
    
    def update(self, arm: str, reward: float, context: Optional[Dict]) -> None:
        self._mv.setdefault(arm, MeanVar()).add(float(reward))

    def stats(self) -> Dict[str, dict]:
        return {a: {"n": s.n, "mean": s.mean, "std": s.std} for a, s in self._mv.items()}
    

def _ctx_to_vec(context: Optional[Dict[str, float]], keys: List[str]) -> List[float]:
    if not keys:
        return []
    ctx = context or {}
    return [float(ctx.get(k, 0.0)) for k in keys]


def _dot(a: List[float], b: List[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


class ContextualLinearBandit:
    name = "contextual_linear"

    def __init__(
        self,
        feature_keys: List[str],
        epsilon: float = 0.1,
        lr: float = 0.05,
        l2: float = 0.001,
        seed: Optional[int] = None,
    ):
        if not feature_keys:
            raise ValueError("feature_keys cannot be empty")
        self.keys = list(feature_keys)
        self.epsilon = float(epsilon)
        self.lr = float(lr)
        self.l2 = float(l2)
        self.rng = random.Random(seed)

        # per-arm linear weights
        self._w: Dict[str, List[float]] = {}
        self._n: Dict[str, int] = {}
        self._mean_reward: Dict[str, float] = {}

    def _ensure_arm(self, arm: str) -> None:
        if arm not in self._w:
            self._w[arm] = [0.0] * len(self.keys)
            self._n[arm] = 0
            self._mean_reward[arm] = 0.0

    def choose_arm(self, arms: List[str], context: Optional[Dict[str, float]] = None) -> str:
        if not arms:
            raise ValueError("No arms")
        for a in arms:
            self._ensure_arm(a)

        if self.rng.random() < self.epsilon:
            return _uniform_choice(self.rng, arms)

        x = _ctx_to_vec(context, self.keys)

        def pred(a: str) -> float:
            return _dot(self._w[a], x)

        return _argmax(arms, pred)

    def update(self, arm: str, reward: float, context: Optional[Dict[str, float]] = None) -> None:
        self._ensure_arm(arm)
        r = float(reward)
        x = _ctx_to_vec(context, self.keys)

        # prediction
        y = _dot(self._w[arm], x)
        err = r - y

        # SGD on squared error with L2 regularization
        w = self._w[arm]
        for i in range(len(w)):
            grad = -2.0 * err * x[i] + 2.0 * self.l2 * w[i]
            w[i] -= self.lr * grad
        self._w[arm] = w

        # track mean reward for reporting
        n = self._n[arm] + 1
        old = self._mean_reward[arm]
        self._mean_reward[arm] = old + (r - old) / n
        self._n[arm] = n

    def stats(self) -> Dict[str, dict]:
        out: Dict[str, dict] = {}
        for a in self._w:
            out[a] = {
                "n": self._n[a],
                "mean_reward": self._mean_reward[a],
                "weights": self._w[a],
                "features": self.keys,
            }
        return out


class SlidingWindowBandit:
    name = "sliding_window"

    def __init__(self, window: int = 50, epsilon: float = 0.05, seed: Optional[int] = None):
        self.window = int(window)
        self.epsilon = float(epsilon)
        self.rng = random.Random(seed)
        self._hist: Dict[str, deque] = {}

    def choose_arm(self, arms: List[str], context: Optional[Dict[str, float]] = None) -> str:
        if not arms:
            raise ValueError("No arms")
        for a in arms:
            self._hist.setdefault(a, deque(maxlen=self.window))

        # explore
        if self.rng.random() < self.epsilon:
            return _uniform_choice(self.rng, arms)

        # prefer arms with data; if none have data, random
        if all(len(self._hist[a]) == 0 for a in arms):
            return _uniform_choice(self.rng, arms)

        def window_mean(a: str) -> float:
            h = self._hist[a]
            if not h:
                return -float("inf")  # push untried down during greedy (exploration handles it)
            return sum(h) / len(h)

        return _argmax(arms, window_mean)

    def update(self, arm: str, reward: float, context: Optional[Dict[str, float]] = None) -> None:
        self._hist.setdefault(arm, deque(maxlen=self.window)).append(float(reward))

    def stats(self) -> Dict[str, dict]:
        out: Dict[str, dict] = {}
        for a, h in self._hist.items():
            out[a] = {"n_window": len(h), "mean_window": (sum(h) / len(h)) if h else 0.0, "window": self.window}
        return out



def make_learner(kind: str, seed: Optional[int] = None, **kwargs) -> Learner:
    k = kind.strip().lower()

    if k in ("sample_average", "sample", "avg", "incremental_mean"):
        return SampleAverageBandit(seed=seed)

    if k in ("ema", "recency", "recency_weighted"):
        return EMABandit(
            alpha=float(kwargs.get("alpha", 0.1)),
            epsilon=float(kwargs.get("epsilon", 0.05)),
            seed=seed,
        )

    if k in ("ucb", "ucb1"):
        return UCB1Bandit(c=float(kwargs.get("c", 2.0)))

    if k in ("thompson", "thompson_sampling", "thompson_gaussian", "ts"):
        return ThompsonGaussianBandit(seed=seed)

    if k in ("contextual", "contextual_bandit", "contextual_linear", "linear"):
        feature_keys = kwargs.get("feature_keys")
        if not isinstance(feature_keys, list) or not feature_keys:
            raise ValueError("Contextual learner requires feature_keys=[...]")
        return ContextualLinearBandit(
            feature_keys=feature_keys,
            epsilon=float(kwargs.get("epsilon", 0.1)),
            lr=float(kwargs.get("lr", 0.05)),
            l2=float(kwargs.get("l2", 0.001)),
            seed=seed,
        )

    if k in ("sliding_window", "window", "sw"):
        return SlidingWindowBandit(
            window=int(kwargs.get("window", 50)),
            epsilon=float(kwargs.get("epsilon", 0.05)),
            seed=seed,
        )

    raise ValueError(f"Unknown learner kind: {kind}")
