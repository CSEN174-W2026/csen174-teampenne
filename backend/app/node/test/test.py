import time
import sys

def main():
    print("Starting demo job...")
    print(f"Python version: {sys.version.split()[0]}")
    total_steps = 5

    for step in range(1, total_steps + 1):
        print(f"Processing step {step}/{total_steps}")
        time.sleep(2)

    print("Demo job completed successfully.")

if __name__ == "__main__":
    main()