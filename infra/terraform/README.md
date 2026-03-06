# EC2 Node Provisioning (Terraform)

This module creates EC2 instances tagged for backend auto-discovery and bootstraps each node from GitHub.

## 1) Prerequisites

- Terraform 1.5+
- AWS CLI configured (`aws configure`)
- A VPC and subnet
- A public or private GitHub repository URL with your node code

## 2) Configure variables

```bash
cd /root/csen-174/infra/terraform
```

Edit `terraform.tfvars` with your real IDs and CIDRs.
Required variable: `github_repo_url`.

Notes:
- `ami_id = null` uses latest Ubuntu 22.04 LTS automatically.
- Default node service port is `5001`.
- The generated cloud-init script installs Python, clones your repo, creates venv, installs deps, and starts systemd service.
- For this project, set `github_branch=Josh-Manager-Agent` so `backend/app/node/node_worker.py` exists.

## 3) Plan and apply

```bash
terraform init
terraform plan
terraform apply
```

After apply, note:

- `node_instance_ids`
- `node_public_ips`

## 4) Backend configuration

Set these in `backend/.env`:

```env
AWS_REGION=us-east-1
EC2_NODE_TAG_KEY=aimse:node
EC2_NODE_TAG_VALUE=true
NODE_SERVICE_PORT=5001
```

Install boto3 in backend venv:

```bash
cd /root/csen-174/backend
source .venv/bin/activate
pip install boto3
```

## 5) Verify

- Start backend and open `GET /nodes` (through your existing frontend).
- Nodes should appear once each EC2 instance is running the node worker API on port `5001`.

## 6) Destroy

```bash
terraform destroy
```
