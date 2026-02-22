from app.main import app, SubmitJobRequest, SubmitJobResult, AgentConfig
from app.state_types import JobRequest, NodeSnapshot
from fastapi.testclient import TestClient
import time

learning_methods = "SampleAverageBandit"
policies = [
    "round_robin",
    "random",
    "latency_aware_ewma",
]

client = TestClient(app) # Create a fake HTTP client that can send requests directly into this FastAPI app object

def get_nodes():
    response = client.get("/nodes")
    if not response:
        print(f"Error: {response.status_code} - {response.text}")
    assert response.status_code == 200
    return response.json()


def test_submit_job(job_id):
    agent_cfg = AgentConfig(
        learner_kind="ucb1",
        goal_kind="min_mean_latency",
        seed=7,
        learner_kwargs={"c": 2.0},
        goal_kwargs={},
    )

    job_req = JobRequest(
        job_id=job_id,
        user_id="user456",
        service_time_ms=500,
        metadata={"type": "test"},
    )

    submit_req = SubmitJobRequest(config=agent_cfg, job=job_req)

    # Pydantic v2:
    payload = submit_req.model_dump() if hasattr(submit_req, "model_dump") else submit_req.dict()

    response = client.post("/jobs/submit", json=payload)

    # Debugging output
    print("Status:", response.status_code)
    print("body:", response.text)

    return response.json()

def test_get_agents():
    response = client.get("/agents")
    if not response:
        print(f"Error: {response.status_code} - {response.text}")
    assert response.status_code == 200
    return response.json()

def test_get_agent_pending():
    agent_cfg = AgentConfig(
        learner_kind="ucb1",
        goal_kind="min_mean_latency",
        seed=7,
        learner_kwargs={"c": 2.0},
        goal_kwargs={},
    )
    response = client.post("/agents/pending",json=agent_cfg.model_dump() if hasattr(agent_cfg, "model_dump") else agent_cfg.dict())
    if not response:
        print(f"Error: {response.status_code} - {response.text}")
    assert response.status_code == 200
    return response.json()


if __name__ == "__main__":
    # Test the /nodes endpoint
    # print("Testing /nodes endpoint...")
    # nodes = get_nodes()
    # print(f"Nodes: {nodes}")

    # print("Testing /jobs/submit endpoint...")
    # res = test_submit_job()
    # print(res)

    # print("Testing /agents endpoint...")
    # agents = test_get_agents()
    # print(f"Agents: {agents}")


    # print("Testing /agents/pending endpoint...")
    test_submit_job("job1")
    test_submit_job("job2")
    test_submit_job("job3")

    pending = test_get_agent_pending()["pending_job_ids"]
    print("Initial pending:", pending)

    while len(pending) > 0:
        time.sleep(1)
        new_pending = test_get_agent_pending()["pending_job_ids"]
        print("Checked pending:", new_pending)
        pending = new_pending

    print("All jobs completed. Final pending list:", pending)