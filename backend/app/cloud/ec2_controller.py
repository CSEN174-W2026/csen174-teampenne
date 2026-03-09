from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional

try:
    import boto3
except Exception:  # pragma: no cover - handled at runtime
    boto3 = None


DEFAULT_TAG_KEY = os.getenv("EC2_NODE_TAG_KEY", "aimse:node")
DEFAULT_TAG_VALUE = os.getenv("EC2_NODE_TAG_VALUE", "true")
DEFAULT_REGION = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-1"
DEFAULT_NAME_PREFIX = (os.getenv("EC2_NODE_NAME_PREFIX", "aimse") or "").strip() or "aimse"


def _ec2_client(region: Optional[str] = None):
    if boto3 is None:
        raise RuntimeError("boto3 is required for EC2 operations. Install with: pip install boto3")
    return boto3.client("ec2", region_name=region or DEFAULT_REGION)


def _name_from_tags(tags: Optional[List[Dict[str, str]]], fallback: str) -> str:
    if not tags:
        return fallback
    for t in tags:
        if t.get("Key") == "Name" and t.get("Value"):
            return t["Value"]
    return fallback


def _to_instance_doc(instance: Dict[str, Any]) -> Dict[str, Any]:
    state = (instance.get("State") or {}).get("Name") or "unknown"
    instance_id = instance["InstanceId"]
    return {
        "instance_id": instance_id,
        "name": _name_from_tags(instance.get("Tags"), fallback=instance_id),
        "state": state,
        "private_ip": instance.get("PrivateIpAddress"),
        "public_ip": instance.get("PublicIpAddress"),
        "public_dns": instance.get("PublicDnsName"),
        "az": instance.get("Placement", {}).get("AvailabilityZone"),
        "region": DEFAULT_REGION,
        "instance_type": instance.get("InstanceType"),
    }


def _next_node_name(ec2: Any, *, name_prefix: str, tag_key: str, tag_value: str) -> str:
    """
    Pick next sequential node name: <prefix>-N, based on existing tagged nodes.
    """
    resp = ec2.describe_instances(
        Filters=[
            {"Name": f"tag:{tag_key}", "Values": [tag_value]},
            {"Name": "instance-state-name", "Values": ["pending", "running", "stopping", "stopped"]},
        ]
    )

    pat = re.compile(rf"^{re.escape(name_prefix)}-(\d+)$")
    max_idx = 0
    for reservation in resp.get("Reservations", []):
        for instance in reservation.get("Instances", []):
            name = _name_from_tags(instance.get("Tags"), fallback="")
            m = pat.match(name)
            if not m:
                continue
            try:
                max_idx = max(max_idx, int(m.group(1)))
            except Exception:
                continue
    return f"{name_prefix}-{max_idx + 1}"


def list_nodes(tag_key: str = DEFAULT_TAG_KEY, tag_value: str = DEFAULT_TAG_VALUE) -> List[Dict[str, Any]]:
    ec2 = _ec2_client()
    resp = ec2.describe_instances(
        Filters=[
            {"Name": f"tag:{tag_key}", "Values": [tag_value]},
            {
                "Name": "instance-state-name",
                "Values": ["pending", "running", "stopping", "stopped"],
            },
        ]
    )

    out: List[Dict[str, Any]] = []
    for reservation in resp.get("Reservations", []):
        for instance in reservation.get("Instances", []):
            out.append(_to_instance_doc(instance))
    return out


def get_latest_ubuntu_ami() -> str:
    """
    Resolve latest Ubuntu 22.04 LTS AMI in current region.
    """
    ec2 = _ec2_client()
    resp = ec2.describe_images(
        Owners=["099720109477"],  # Canonical
        Filters=[
            {"Name": "name", "Values": ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]},
            {"Name": "state", "Values": ["available"]},
        ],
    )
    images = resp.get("Images", [])
    if not images:
        raise RuntimeError("No Ubuntu 22.04 AMI found in this region")
    images.sort(key=lambda x: x.get("CreationDate", ""))
    return images[-1]["ImageId"]


def create_vm(
    *,
    image_id: str,
    instance_type: str,
    subnet_id: str,
    security_group_id: str,
    key_name: Optional[str] = None,
    iam_instance_profile: Optional[str] = None,
    user_data: Optional[str] = None,
    tag_key: str = DEFAULT_TAG_KEY,
    tag_value: str = DEFAULT_TAG_VALUE,
    name_prefix: str = DEFAULT_NAME_PREFIX,
) -> Dict[str, Any]:
    ec2 = _ec2_client()
    node_name = _next_node_name(ec2, name_prefix=name_prefix, tag_key=tag_key, tag_value=tag_value)

    tags = [
        {"Key": "Name", "Value": node_name},
        {"Key": tag_key, "Value": tag_value},
    ]

    kwargs: Dict[str, Any] = {
        "ImageId": image_id,
        "InstanceType": instance_type,
        "MinCount": 1,
        "MaxCount": 1,
        "SubnetId": subnet_id,
        "SecurityGroupIds": [security_group_id],
        "TagSpecifications": [{"ResourceType": "instance", "Tags": tags}],
    }
    if key_name:
        kwargs["KeyName"] = key_name
    if iam_instance_profile:
        kwargs["IamInstanceProfile"] = {"Name": iam_instance_profile}
    if user_data:
        kwargs["UserData"] = user_data

    run = ec2.run_instances(**kwargs)
    instance = run["Instances"][0]
    return _to_instance_doc(instance)


def start_vm(instance_id: str) -> Dict[str, Any]:
    ec2 = _ec2_client()
    resp = ec2.start_instances(InstanceIds=[instance_id])
    state = resp.get("StartingInstances", [{}])[0]
    return {
        "instance_id": state.get("InstanceId", instance_id),
        "previous_state": (state.get("PreviousState") or {}).get("Name"),
        "current_state": (state.get("CurrentState") or {}).get("Name"),
    }


def stop_vm(instance_id: str) -> Dict[str, Any]:
    ec2 = _ec2_client()
    resp = ec2.stop_instances(InstanceIds=[instance_id])
    state = resp.get("StoppingInstances", [{}])[0]
    return {
        "instance_id": state.get("InstanceId", instance_id),
        "previous_state": (state.get("PreviousState") or {}).get("Name"),
        "current_state": (state.get("CurrentState") or {}).get("Name"),
    }


def delete_vm(instance_id: str) -> Dict[str, Any]:
    ec2 = _ec2_client()
    resp = ec2.terminate_instances(InstanceIds=[instance_id])
    state = resp.get("TerminatingInstances", [{}])[0]
    return {
        "instance_id": state.get("InstanceId", instance_id),
        "previous_state": (state.get("PreviousState") or {}).get("Name"),
        "current_state": (state.get("CurrentState") or {}).get("Name"),
    }


def get_instance_ip(instance_id: str) -> Optional[str]:
    ec2 = _ec2_client()
    resp = ec2.describe_instances(InstanceIds=[instance_id])
    for reservation in resp.get("Reservations", []):
        for instance in reservation.get("Instances", []):
            return instance.get("PublicIpAddress") or instance.get("PrivateIpAddress")
    return None
