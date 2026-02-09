# test_node_client.py
from node.node_client import NodeClient
from state_types import NodeSnapshot, JobRequest

VM_IP = "192.168.1.76"
PORT = 8001

def main():
    node = NodeSnapshot(
        name="UbuntuNode1",
        host=VM_IP,
        port=PORT,
        cpus=2,
        memory_mb=4096,
    )

    client = NodeClient(timeout_s=2.0)

    # 1) pull metrics
    snap = client.get_metrics(node)
    print("METRICS:", snap)

    # 2) submit a job
    resp = client.submit_job(
        node,
        JobRequest(job_id="py-j1", user_id="u1", service_time_ms=1500, metadata={}),
    )
    print("SUBMIT:", resp)

    # 3) pull metrics again
    snap2 = client.get_metrics(node)
    print("AFTER:", snap2)

if __name__ == "__main__":
    main()
