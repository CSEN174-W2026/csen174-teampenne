import subprocess
import re
from state_types import NodeSnapshot

VBOX = r"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"

def get_running_vm_names():
    out = subprocess.check_output([VBOX, "list", "runningvms"], text=True)
    names = []
    for line in out.splitlines():
        if '"' in line:
            names.append(line.split('"')[1])
    return names


def get_vm_specs(vm_name):
    out = subprocess.check_output([VBOX, "showvminfo", vm_name, "--machinereadable"], text=True)
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


def discover_nodes():
    nodes = []
    for vm in get_running_vm_names():
        cpus, memory = get_vm_specs(vm)
        ip = get_vm_ip(vm)
        if ip:
            nodes.append(
                NodeSnapshot(
                    name=vm,
                    host=ip,
                    port=8001,
                    cpus=cpus,
                    memory_mb=memory
                )
            )
    return nodes
