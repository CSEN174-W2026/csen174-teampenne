import subprocess
import sys
import os
import shutil

# vbox_cmd = None
# vbox_path_wsl = "/mnt/c/Program Files/Oracle/VirtualBox/VBoxManage.exe"

# if os.path.exists(vbox_path_wsl):
#     vbox_cmd = vbox_path_wsl
# else:
#     vbox_cmd = shutil.which("VBoxManage")

vbox_cmd = r"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"

if not vbox_cmd:
    print("Error: 'VBoxManage' not found.")
    sys.exit(1)

def get_running_vms():
    try:
        result = subprocess.run(
            [vbox_cmd, "list", "runningvms"],
            capture_output=True, text=True, check=True
        )
        vm_names = []
        for line in result.stdout.splitlines():
            # Output format is: "VM Name" {UUID}
            # We split by " to grab the name
            if '"' in line:
                vm_names.append(line.split('"')[1])
        return vm_names
    except subprocess.CalledProcessError:
        return []

def get_vm_specs(vm_name):
    try:
        result = subprocess.run(
            [vbox_cmd, "showvminfo", vm_name, "--machinereadable"],
            capture_output=True, text=True, check=True
        )
        specs = {}
        for line in result.stdout.splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                value = value.strip('"')
                if key == "cpus":
                    specs['cpus'] = value
                elif key == "memory":
                    specs['memory'] = value
        return specs
    except subprocess.CalledProcessError:
        return None


print("Scanning for running VMs")
running_vms = get_running_vms()

if not running_vms:
    print("No VMs active")
else:
    print(f"Found {len(running_vms)} running VM(s).\n")
    print(f"{'VM Name':<30} | {'CPUs':<5} | {'Memory (MB)':<10}")
    print("-" * 55)
    
    for vm in running_vms:
        specs = get_vm_specs(vm)
        if specs:
            c = specs.get('cpus', '-')
            m = specs.get('memory', '-')
            print(f"{vm:<30} | {c:<5} | {m:<10}")