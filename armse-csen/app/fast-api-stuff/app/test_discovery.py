# test_discovery.py
from virtualbox import discover_nodes

def main():
    nodes = discover_nodes()
    if not nodes:
        raise SystemExit("No nodes discovered. Are VMs running + guest additions/IP property available?")

    print(f"Discovered {len(nodes)} node(s):")
    for n in nodes:
        print(f" - {n.name} @ {n.host}:{n.port}  cpus={n.cpus} mem={n.memory_mb}MB")

if __name__ == "__main__":
    main()
