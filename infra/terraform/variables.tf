variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name used for tags/names"
  type        = string
  default     = "csen174"
}

variable "vpc_id" {
  description = "VPC ID where instances will be created"
  type        = string
}

variable "subnet_id" {
  description = "Subnet ID for node instances"
  type        = string
}

variable "ami_id" {
  description = "Optional AMI ID override. If null, latest Ubuntu 22.04 LTS AMI is used."
  type        = string
  default     = null
}

variable "instance_type" {
  description = "EC2 instance type for node workers"
  type        = string
  default     = "t3.micro"
}

variable "node_count" {
  description = "How many node instances to create"
  type        = number
  default     = 2
}

variable "node_port" {
  description = "Port where node worker API listens"
  type        = number
  default     = 5001
}

variable "allowed_ingress_cidrs" {
  description = "CIDRs allowed to call node API port"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "allowed_ssh_cidrs" {
  description = "CIDRs allowed for SSH access"
  type        = list(string)
  default     = []
}

variable "key_name" {
  description = "Optional EC2 key pair name"
  type        = string
  default     = null
}

variable "iam_instance_profile" {
  description = "Optional IAM instance profile name"
  type        = string
  default     = null
}

variable "user_data" {
  description = "Optional raw cloud-init script override. If null, generated bootstrap script is used."
  type        = string
  default     = null
}

variable "node_tag_key" {
  description = "Tag key used by backend EC2 discovery"
  type        = string
  default     = "aimse:node"
}

variable "node_tag_value" {
  description = "Tag value used by backend EC2 discovery"
  type        = string
  default     = "true"
}

variable "github_repo_url" {
  description = "GitHub repository URL cloned by node bootstrap script"
  type        = string
}

variable "github_branch" {
  description = "Git branch to checkout on node bootstrap"
  type        = string
  default     = "main"
}

variable "repo_clone_dir" {
  description = "Destination directory on EC2 where repo is cloned"
  type        = string
  default     = "/opt/csen174"
}

variable "node_working_dir" {
  description = "Working directory (relative to repo root) used for venv and launch"
  type        = string
  default     = "backend"
}

variable "requirements_file" {
  description = "Requirements file path relative to repo root; installed when present"
  type        = string
  default     = "backend/requirements.txt"
}

variable "extra_pip_packages" {
  description = "Additional pip packages installed in node venv"
  type        = list(string)
  default     = ["fastapi", "uvicorn[standard]", "pydantic", "psutil", "requests"]
}

variable "node_service_name" {
  description = "systemd service name for node process"
  type        = string
  default     = "csen174-node"
}

variable "node_start_command" {
  description = "Shell command run by systemd to start node process"
  type        = string
  default     = null
}
