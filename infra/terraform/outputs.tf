output "node_instance_ids" {
  value = [for i in aws_instance.nodes : i.id]
}

output "node_public_ips" {
  value = [for i in aws_instance.nodes : i.public_ip]
}

output "node_private_ips" {
  value = [for i in aws_instance.nodes : i.private_ip]
}

output "node_security_group_id" {
  value = aws_security_group.node_sg.id
}
