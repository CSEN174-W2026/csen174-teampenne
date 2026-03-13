terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_ami" "ubuntu_2204" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

locals {
  default_node_start_command = "source venv/bin/activate && python -m uvicorn app.node.node_worker:app --host 0.0.0.0 --port ${var.node_port}"
  effective_node_start_cmd   = coalesce(var.node_start_command, local.default_node_start_command)
  rendered_user_data = templatefile("${path.module}/templates/node-bootstrap.sh.tftpl", {
    github_repo_url    = var.github_repo_url
    github_branch      = var.github_branch
    repo_clone_dir     = var.repo_clone_dir
    node_working_dir   = var.node_working_dir
    requirements_file  = var.requirements_file
    extra_pip_packages = var.extra_pip_packages
    node_service_name  = var.node_service_name
    node_start_command = local.effective_node_start_cmd
  })
  effective_user_data = coalesce(var.user_data, local.rendered_user_data)
}

resource "aws_security_group" "node_sg" {
  name        = "${var.project_name}-node-sg-2"
  description = "Security group for CSEN174 node workers"
  vpc_id      = var.vpc_id

  ingress {
    description = "Node worker API"
    from_port   = var.node_port
    to_port     = var.node_port
    protocol    = "tcp"
    cidr_blocks = var.allowed_ingress_cidrs
  }

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.allowed_ssh_cidrs
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name            = "${var.project_name}-node-sg"
    csen174_managed = "true"
  }
}

resource "aws_instance" "nodes" {
  count                  = var.node_count
  ami                    = coalesce(var.ami_id, data.aws_ami.ubuntu_2204.id)
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.node_sg.id]
  key_name               = var.key_name
  iam_instance_profile   = var.iam_instance_profile
  user_data              = local.effective_user_data
  user_data_replace_on_change = true

  tags = {
    Name               = "${var.project_name}-node-${count.index + 1}"
    (var.node_tag_key) = var.node_tag_value
    Project            = var.project_name
  }
}
