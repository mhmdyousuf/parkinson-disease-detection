import qrcode
import sys
import socket

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "localhost"

def generate_qr(url):
    qr = qrcode.QRCode(version=1, box_size=1, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    
    # Print to terminal using ASCII art
    qr.print_ascii(invert=True)
    # Also print the text URL for backup
    print(f"\n🔗 Magic Link: {url}")

if __name__ == "__main__":
    target_url = sys.argv[1] if len(sys.argv) > 1 else f"http://{get_local_ip()}:8081"
    generate_qr(target_url)
