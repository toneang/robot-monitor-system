"""Debug script to test full system prompt API call."""
import json, os, re, time, requests, sys

API_BASE = os.environ.get("ANTHROPIC_BASE_URL", "https://api.deepseek.com/anthropic")
API_TOKEN = os.environ.get("ANTHROPIC_AUTH_TOKEN", "")

# Read generate_tasks.py and extract the SYSTEM_PROMPT as a string
with open("generate_tasks.py") as f:
    script = f.read()

# Find FEWSHOT_EXAMPLES
m = re.search(r'FEWSHOT_EXAMPLES = "(.+?)"\s*$', script, re.DOTALL)
if not m:
    m = re.search(r'FEWSHOT_EXAMPLES = "(.+?)(?="\s*$)', script, re.DOTALL)
print(f"Fewshot match: {bool(m)}")

# Find SYSTEM_PROMPT
# It's an f-string, extract the template parts
start = script.find('SYSTEM_PROMPT = f"""')
end = script.find('"""\n\n\ndef generate_tasks_for_date')
sysprompt_raw = script[start:end]
print(f"Sysprompt length: {len(sysprompt_raw)}")

# Build a minimal test prompt
test_sysprompt = """You are a creative robot task generator for an office service robot.
Generate diverse, natural-language commands that a human would give to a robot assistant.

Objects: red apple, green apple, banana, orange, chocolate marked with Snickers, coca-cola, Ganten drinking water bottle, red packaged cake, Orion Shuyuan non-fried potato chips, Oreo original flavor sandwich cookie box, white cup, green cup, blue cup, game controller, mouse
People: Okng, yyw, zkm, taoshida, zsx, wyj
Locations: workstations (506B, 506J, 506L, 308), snack area, rest area, conference rooms (511, 123)

Examples of real tasks from the database:
- find wyj
- say hello
- go home
- Check the environment.
- pick up a banana for me
- help me get an apple
- find taoshida and say hello
- please help me deliver the red packaged cake to student zkm
- Go to workstation 506L, check if there is a blue cup there, then come back and tell me the result
- I'm hungry. Can you get me a food that can quickly relieve my hunger?

Output ONLY valid JSON array, no markdown formatting."""

user_msg = """Generate exactly 25 diverse robot tasks for date 2026-05-11.
Requirements:
- ~30% simple (short, single action), ~40% medium, ~30% hard (multi-step)
- Model evenly distributed among rule/vlm/vlm-mem
- Priority: mostly low, some medium, few high
- Times spread across 9:00-20:00, sorted chronologically
- Location field is empty string ""
- Creator always "aaa"
- Be creative and diverse! Vary phrasing, mix tones.
- Output ONLY valid JSON array, no markdown."""

print("Calling API...")
t0 = time.time()
try:
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
            "system": test_sysprompt,
            "messages": [{"role": "user", "content": user_msg}],
        },
        timeout=180,
    )
    elapsed = time.time() - t0
    print(f"Response received in {elapsed:.1f}s, status={resp.status_code}")

    if resp.status_code != 200:
        print(f"Error: {resp.text[:500]}")
        sys.exit(1)

    data = resp.json()
    text_blocks = [b["text"] for b in data["content"] if b.get("type") == "text"]
    text = "".join(text_blocks)
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

    for t in tasks[:3]:
        print(f"  [{t['execute_time']}] {t['priority']:6s} {t['model']:7s} | {t['description']}")
    print("  ...")
    for t in tasks[-3:]:
        print(f"  [{t['execute_time']}] {t['priority']:6s} {t['model']:7s} | {t['description']}")

except Exception as e:
    elapsed = time.time() - t0
    print(f"Error after {elapsed:.1f}s: {e}")
