"""Quick test of LLM task generation."""
import json
import os
import re
import requests

API_BASE = os.environ.get("ANTHROPIC_BASE_URL", "https://api.deepseek.com/anthropic")
API_TOKEN = os.environ.get("ANTHROPIC_AUTH_TOKEN", "")

# Read the system prompt from generate_tasks.py
with open("generate_tasks.py") as f:
    script = f.read()

# Extract FEWSHOT_EXAMPLES and SYSTEM_PROMPT
m = re.search(r"FEWSHOT_EXAMPLES = \"\"\"(.+?)\"\"\"", script, re.DOTALL)
fewshot = m.group(1) if m else ""

m = re.search(r'SYSTEM_PROMPT = f"""(.*?)"""', script, re.DOTALL)
sysprompt = m.group(1) if m else "You are a helpful assistant."

user_msg = """Generate exactly 50 diverse robot tasks for date 2026-05-11.
Requirements:
- ~30% simple, ~40% medium, ~30% hard difficulty
- Model evenly distributed among rule/vlm/vlm-mem
- Priority: mostly low, some medium, few high
- Times spread across 9:00-20:00, sorted chronologically
- Location field is always empty string
- Creator always 'aaa'
- Be creative and diverse in phrasing!
- Output ONLY valid JSON array, no markdown formatting."""

resp = requests.post(
    f"{API_BASE}/v1/messages",
    headers={
        "x-api-key": API_TOKEN,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
    },
    json={
        "model": "deepseek-v4-pro",
        "max_tokens": 8192,
        "temperature": 0.9,
        "system": sysprompt,
        "messages": [{"role": "user", "content": user_msg}],
    },
    timeout=120,
)
data = resp.json()

# Extract text blocks
text_blocks = [b["text"] for b in data["content"] if b.get("type") == "text"]
text = "".join(text_blocks)

# Strip markdown code fences
text = text.strip()
if text.startswith("```"):
    lines = text.split("\n")
    if lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].startswith("```"):
        lines = lines[:-1]
    text = "\n".join(lines)

tasks = json.loads(text)
print(f"Got {len(tasks)} tasks")
print()

# Show a diverse sample
for t in tasks[:5]:
    print(f"  [{t.get('execute_time','?')}] {t.get('priority','?'):6s} {t.get('model','?'):7s} | {t.get('description','?')}")
print("  ...")
print(f"  (middle {len(tasks)-8} tasks)")
print("  ...")
for t in tasks[-3:]:
    print(f"  [{t.get('execute_time','?')}] {t.get('priority','?'):6s} {t.get('model','?'):7s} | {t.get('description','?')}")
