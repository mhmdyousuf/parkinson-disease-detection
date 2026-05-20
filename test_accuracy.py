import asyncio
import websockets
import json
import time
import math

async def simulate_tremor(name="Test Trace", freq=5.0):
    uri = "ws://localhost:8000/ws/sensor"
    print(f"--- Simulating {freq}Hz Tremor for {name} ---")
    
    try:
        async with websockets.connect(uri) as websocket:
            # 1. Send patient name
            await websocket.send(json.dumps({ "patient_name": name }))
            
            # 2. Simulate 30 seconds of data at 50Hz (1500 samples)
            start_ts = int(time.time() * 1000)
            for i in range(1500):
                t = i * 0.02
                # Sine wave on AX with amplitude 0.8 (at 5Hz)
                ax = 0.8 * math.sin(2 * math.pi * freq * t)
                
                cur_ts = start_ts + (i * 20) # 20ms steps for 50Hz

                data = {
                    "ax": ax,
                    "ay": 9.81,  # GRAVITY ON Y (AS OBSERVED BY USER)
                    "az": 0.1,
                    "gx": 0.0,
                    "ts": cur_ts
                }
                await websocket.send(json.dumps(data))
                
                if i % 200 == 0:
                    await asyncio.sleep(0.01)

            print("  Waiting for analysis...")
            # 3. Get result
            response = await websocket.recv()
            result = json.loads(response)
            print(f"\nRESULT: {result}")
            return result
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    # Test 5Hz (Parkinson's Range) with Gravity on Y
    asyncio.run(simulate_tremor("Gravity_On_Y_Test", 5.0))
