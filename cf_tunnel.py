import subprocess
import re
import sys
import time

def start_tunnel(port):
    print(f"[*] Starting Cloudflare Tunnel on port {port}...")
    
    # Start process
    process = subprocess.Popen(
        [r".\cloudflared.exe", "tunnel", "--url", f"http://127.0.0.1:{port}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1
    )

    url = None
    print("[*] Waiting for Magic Link (approx 10-15 seconds)...")
    
    # Read stderr line by line
    for line in iter(process.stderr.readline, ''):
        line = line.strip()
        if not line:
            continue
            
        print(f"  [Log] {line[:100]}...") # Print a snippet to verify it's working
            
        # Match URL: https://some-random-words.trycloudflare.com
        match = re.search(r'https://[a-zA-Z0-9-]+\.trycloudflare\.com', line)
        if match and "api.trycloudflare" not in match.group(0):
            url = match.group(0)
            break

    if url:
        print(f"\n[SUCCESS] Magic Link Generated: {url}")
        with open("MAGIC_URL.txt", "w") as f:
            f.write(url)
    else:
        print("\n[ERROR] Failed to generate Magic Link. Cloudflare might be blocked.")
    
    return process

if __name__ == "__main__":
    p = start_tunnel(8000)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        p.terminate()
