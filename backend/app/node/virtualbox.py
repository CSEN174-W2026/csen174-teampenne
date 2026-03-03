import subprocess
import re
from app.state_types import NodeSnapshot

VBOX =r"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"# Absolute path to VBoxManage on Windows


def get_running_vm_names():
    out = subprocess.check_output([VBOX, "list", "runningvms"], text=True) # Run shell command to get list of running VMs
    names = [] 
    for line in out.splitlines():
        if '"' in line:
            names.append(line.split('"')[1])
    return names 


def get_vm_info(vm_name):
    return subprocess.check_output([VBOX, "showvminfo", vm_name, "--machinereadable"], text=True)


def get_vm_specs(vm_name):
    out = get_vm_info(vm_name) # Runs VBoxManage showvminfo <vm_name> --machinereadable
    cpus = None
    memory = None
    for line in out.splitlines():
        if line.startswith("cpus="):
            cpus = int(line.split("=")[1])
        if line.startswith("memory="):
            memory = int(line.split("=")[1])
    return cpus, memory


def get_vm_ip(vm_name):
    # Query guest for IP
    out = subprocess.check_output([
        VBOX, "guestproperty", "get", vm_name,
        "/VirtualBox/GuestInfo/Net/0/V4/IP"
    ], text=True)

    if "No value set!" in out:
        return None
    return out.strip().split()[-1]


def get_forwarded_host_port(vm_name, guest_port=5001):
    """
    Reads VirtualBox NAT forwarding rules and returns the host port mapped
    to the requested guest port (default 5001). Returns None if not found.
    """
    out = get_vm_info(vm_name)
    pat = re.compile(r'^Forwarding\(\d+\)="[^,]*,tcp,[^,]*,(\d+),[^,]*,(\d+)"$')
    for line in out.splitlines():
        m = pat.match(line.strip())
        if not m:
            continue
        host_port = int(m.group(1))
        mapped_guest_port = int(m.group(2))
        if mapped_guest_port == guest_port:
            return host_port
    return None


def discover_nodes():
    nodes = []
    for vm in get_running_vm_names():
        cpus, memory = get_vm_specs(vm)
        ip = get_vm_ip(vm)
        forwarded_port = get_forwarded_host_port(vm, guest_port=5001)

        # Prefer NAT-forwarded localhost when present; this works reliably from WSL.
        if forwarded_port is not None:
            host = "192.168.254.192"
            port = forwarded_port
        elif ip:
            host = ip
            port = 5001
        else:
            continue

        nodes.append(
            NodeSnapshot(
                name=vm,
                host=host,
                port=port,
                cpus=cpus,
                memory_mb=memory
            )
        )
    return nodes
