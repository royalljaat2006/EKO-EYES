#!/usr/bin/env python3
"""
Single-file runner for the E.Y.E.S. Inactivity Tracking application.
Launches both the Node/Express backend and Vite frontend servers, and opens the preview.
"""

import sys
import os
import socket
import time
import webbrowser
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent

BACKEND_PORT = 4000
FRONTEND_PORT = 5173
HOST = "127.0.0.1"
URL = f"http://{HOST}:{FRONTEND_PORT}"

def is_port_in_use(host: str, port: int) -> bool:
    """Check if the target port is already in use on IPv4 or IPv6 loopback."""
    for h in [host, "::1"]:
        try:
            family = socket.AF_INET6 if ":" in h else socket.AF_INET
            with socket.socket(family, socket.SOCK_STREAM) as s:
                s.settimeout(0.3)
                s.connect((h, port))
                return True
        except (socket.timeout, ConnectionRefusedError, OSError):
            continue
    return False


def check_and_install_dependencies(path: Path, name: str):
    """Ensure node_modules exists, otherwise install them."""
    node_modules = path / "node_modules"
    if not node_modules.exists():
        print(f"[Info] {name} node_modules not found. Installing dependencies...")
        try:
            subprocess.run("npm install", shell=True, cwd=str(path), check=True)
            print(f"[OK] {name} dependencies installed.")
        except subprocess.CalledProcessError as e:
            print(f"[Error] Failed to install {name} dependencies: {e}")
            sys.exit(1)
    else:
        print(f"[OK] {name} node_modules verified.")

def kill_process_on_port(port: int):
    """Find and kill any process listening on the specified port on Windows."""
    try:
        result = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            return
            
        pids = set()
        for line in result.stdout.splitlines():
            if f":{port}" in line:
                parts = line.strip().split()
                if len(parts) >= 5:
                    pid = parts[-1]
                    if pid.isdigit() and int(pid) > 0:
                        pids.add(int(pid))
                        
        for pid in pids:
            print(f"[Info] Cleaning up process (PID {pid}) on port {port}...")
            # Use taskkill tree kill (/T) and force (/F) to clean up node and tsx sub-processes
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)
    except Exception as e:
        print(f"Error cleaning up port {port}: {e}")

def main():
    print("=" * 60)
    print(" E.Y.E.S. (Eko Yield & Escalation System) - Dev Runner")
    print("=" * 60)

    # 1. Clean up any leftover processes on ports 4000 and 5173
    kill_process_on_port(BACKEND_PORT)
    kill_process_on_port(FRONTEND_PORT)

    # 2. Verify dependencies
    check_and_install_dependencies(PROJECT_ROOT / "backend", "Backend")
    check_and_install_dependencies(PROJECT_ROOT / "frontend", "Frontend")

    # 3. Quick port verification post-cleanup
    backend_active = is_port_in_use(HOST, BACKEND_PORT)
    frontend_active = is_port_in_use(HOST, FRONTEND_PORT)

    if backend_active or frontend_active:
        print("\n[!] Warning: Port 4000 (Backend) or 5173 (Frontend) is still in use.")
        if frontend_active:
            print(f"Opening browser preview directly at {URL}...")
            webbrowser.open(URL)
            return

    backend_proc = None
    frontend_proc = None

    try:
        # 4. Start Backend
        print(f"\nStarting Backend Server on port {BACKEND_PORT}...")
        backend_proc = subprocess.Popen(
            "npm run dev",
            shell=True,
            cwd=str(PROJECT_ROOT / "backend"),
            stdin=subprocess.DEVNULL
        )

        # 5. Start Frontend
        print(f"Starting Frontend Server on port {FRONTEND_PORT}...")
        frontend_proc = subprocess.Popen(
            "npm run dev",
            shell=True,
            cwd=str(PROJECT_ROOT / "frontend"),
            stdin=subprocess.DEVNULL
        )

        print("\nWaiting for servers to initialize...")
        started = False
        for _ in range(120):  # Wait up to 60 seconds
            time.sleep(0.5)
            if is_port_in_use(HOST, FRONTEND_PORT) and is_port_in_use(HOST, BACKEND_PORT):
                started = True
                break
            
            # Check if any process died early
            if backend_proc.poll() is not None:
                print("\n[Error] Backend server exited unexpectedly!")
                break
            if frontend_proc.poll() is not None:
                print("\n[Error] Frontend server exited unexpectedly!")
                break

        if started:
            print(f"\n[+] Both servers are up! Automatically opening preview at {URL} ...")
            webbrowser.open(URL)
            print("\nPress Ctrl+C in this terminal window to stop both servers.")
            
            # Keep running until interrupted or a server stops
            while True:
                time.sleep(1)
                if backend_proc.poll() is not None:
                    print("\n[!] Backend server stopped.")
                    break
                if frontend_proc.poll() is not None:
                    print("\n[!] Frontend server stopped.")
                    break
        else:
            print("\n[!] Failed to start the servers. Check console logs above.")

    except KeyboardInterrupt:
        print("\n[Info] Stopping servers...")
    finally:
        # Clean up both process trees on exit
        for proc in [backend_proc, frontend_proc]:
            if proc and proc.poll() is None:
                try:
                    subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
                except Exception:
                    pass
        
        # Double safety: check ports and kill anything still listening
        kill_process_on_port(BACKEND_PORT)
        kill_process_on_port(FRONTEND_PORT)
        print("Servers stopped. Goodbye!")
        print("=" * 60)

if __name__ == "__main__":
    main()
