# Process-transport fixture, not a built-in bot.
import json
import sys

for line in sys.stdin:
    message = json.loads(line)
    if message["type"] == "start":
        reply = {"type": "ready", "protocol": 1, "name": "Python 测试席"}
    else:
        reply = {
            "type": "action",
            "tick": message["tick"],
            "action": {"throttle": 0, "turn": 0, "fire": False},
        }
    print(json.dumps(reply), flush=True)
