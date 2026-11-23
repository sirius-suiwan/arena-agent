import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    if msg["type"] == "start":
        response = {"type": "ready", "protocol": 1}
    elif msg["type"] == "observe":
        tick = msg["tick"]
        response = {
            "type": "action",
            "tick": tick,
            "action": {"throttle": 1, "turn": -1 if tick % 120 < 40 else 0, "fire": True},
        }
    else:
        continue
    print(json.dumps(response), flush=True)
