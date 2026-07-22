#!/usr/bin/env python3
"""
LLM-powered Task Generator for Robot Monitor System
====================================================
Uses DeepSeek API to generate diverse robot task descriptions.
LLM generates descriptions only; metadata (time, model, priority)
is assigned programmatically.

Concurrent API calls for speed.

Usage:
    python generate_tasks.py [--output tasks_generated.csv] [--workers 4]
"""

import csv
import json
import os
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path

import requests

# =============================================================================
# API CONFIGURATION
# =============================================================================
API_BASE = os.environ.get("ANTHROPIC_BASE_URL", "https://api.deepseek.com/anthropic")
API_TOKEN = os.environ.get("ANTHROPIC_AUTH_TOKEN", "sk-87cdbdf0150a4c68abdc4780aa2dc0c9")
API_MODEL = os.environ.get("ANTHROPIC_DEFAULT_OPUS_MODEL", "deepseek-v4-pro")

CREATOR = "aaa"
MODELS = ["rule", "vlm", "vlm-mem"]

# =============================================================================
# SYSTEM PROMPT
# =============================================================================
SYSTEM_PROMPT = (
    "You are a creative robot task generator for an office service robot. "
    "Generate diverse, natural-language commands that a human would give to a robot.\n"
    "\n"
    "Robot capabilities: navigate to locations, find people/objects, pick up, deliver, "
    "speak messages, check environments.\n"
    "\n"
    "Objects (use DETAILED descriptions for better recognition):\n"
    "Fruits: red apple, green apple, banana, orange\n"
    "Snacks: a chocolate marked with Snickers, red packaged cake, "
    "Orion Shuyuan non-fried potato chips, Oreo original flavor sandwich cookie box\n"
    "Drinks: coca-cola, Ganten drinking water bottle, Vitasoy chocolate soya drink, "
    "Krima jasmine milk green tea, Doubendou original flavor soy milk, a bottle of water\n"
    "Items: white cup, green cup, blue cup, black game controller, mouse\n"
    "\n"
    "Locations: workstations (506B, 506J, 506L, 308), snack area, rest area, "
    "conference rooms (511, 123), table, desk\n"
    "\n"
    "People: Okng, yyw, zkm, taoshida, zsx, wyj\n"
    "\n"
    "Difficulty levels:\n"
    "- Simple (30%): single action, short — find person/object, say hello, check environment, go to location, go home\n"
    "- Medium (40%): one-step interaction — pick up X for me/someone, help me get X, "
    "go to area to pick up X, find person and say hello, give me X\n"
    "- Hard (30%): multi-step/conditional — deliver X to person, go to area to pick up X for me, "
    "find A and B then tell them message, check condition at location and report back, "
    "notify person to attend meeting, hunger/thirst with preference, find person then say message\n"
    "\n"
    "Real examples from database:\n"
    "Simple: find wyj | say hello | go home | Check the environment. | Inspect the current environment. | "
    "find an apple | explore the office | tell me a joke | Go to the area near the workstation. | "
    "look for a banana | find a chocolate | what time is it\n"
    "Medium: pick up a banana for me | help me get an apple | "
    "could you help me find Oreo original flavor sandwich cookie box | "
    "go to the snack area and pick up red packaged cake | "
    "find taoshida and say hello | give me a bottle of water | "
    "Pick a banana and place it on the table | say hello to wyj | "
    "I'll be off work at 17:30. Could you please remind me then that it's time for dinner? | "
    "Pick up an apple and place it on the table | "
    "help me get my favorite fruit | could you give me something to eat?\n"
    "Hard: please help me deliver the Oreo original flavor sandwich cookie box to student zkm | "
    "please go to the snack area to pick up an apple for me | "
    "Find zkm and taoshida, tell them there's a PPT they need to make, and ask them to come see me at 5 o'clock | "
    "Can you check if yyw is at his workstation, and then come back and let me know? | "
    "Go to workstation 506L, check if there is a blue cup there, then come back and tell me the result | "
    "notify student Okng to have a meeting in the 511 conference room | "
    "I'm hungry. Can you get me a food that can quickly relieve my hunger? | "
    "Find wyj, then say to them: 'Good afternoon, work hard' | "
    "Help me bring over the food with the brightest color. | "
    "choose a red color fruit and deliver it to zkm | "
    "Explore the office and find the snack area\n"
    "\n"
    "Diversity rules:\n"
    "1. Vary phrasing: find/look for/search for/where is/can you locate/I need to find\n"
    "2. Mix tones: casual (grab me), polite (could you please), direct (get X), formal (please help me)\n"
    "3. Include occasional minor misspellings and emotional expressions\n"
    "4. Sometimes use detailed object descriptions, sometimes short names\n"
    "5. Be creative! Do not repeat the same pattern twice in a row.\n"
    "\n"
    "Output format: ONE task description per line. No numbers, no JSON, no marks. Just the raw description text.\n"
    "Output exactly 50 lines. No explanations before or after."
)


def generate_descriptions_for_date(date_str):
    """Call LLM to generate 50 diverse task descriptions for a date."""
    user_msg = (
        f"Generate exactly 50 diverse robot task descriptions for {date_str}.\n"
        f"~30% simple, ~40% medium, ~30% hard difficulty.\n"
        f"Output ONE description per line, no numbering, no JSON.\n"
        f"Be creative — avoid repeating the same pattern!"
    )

    resp = requests.post(
        f"{API_BASE}/v1/messages",
        headers={
            "x-api-key": API_TOKEN,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
        },
        json={
            "model": API_MODEL,
            "max_tokens": 4096,
            "temperature": 0.95,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": user_msg}],
        },
        timeout=180,
    )
    resp.raise_for_status()
    data = resp.json()

    text_blocks = [b["text"] for b in data["content"] if b.get("type") == "text"]
    text = "".join(text_blocks).strip()

    # Parse lines: one description per line
    lines = []
    for line in text.split("\n"):
        line = line.strip()
        # Remove common prefixes like "1. ", "- ", etc.
        if not line:
            continue
        # Remove leading numbering (e.g., "1. ", "- ", "12) ")
        line = re.sub(r'^[\d\s.\-)\]]+', '', line).strip()
        if line:
            lines.append(line)

    return lines[:50] if len(lines) >= 50 else lines


def assign_metadata(descriptions, date):
    """Assign times, models, priorities to descriptions."""
    tasks = []

    for desc in descriptions:
        # Random time in office hours
        hour = random.choice(
            list(range(9, 12)) * 2 + list(range(14, 19)) * 4 + list(range(19, 21))
        )
        minute = random.randint(0, 59)
        second = random.randint(0, 59)
        exec_time = datetime(date.year, date.month, date.day, hour, minute, second)

        # Determine priority based on approximate difficulty
        word_count = len(desc.split())
        if word_count <= 4:
            priority = random.choices(["low", "medium", "high"], weights=[7, 2, 1])[0]
        elif word_count <= 12:
            priority = random.choices(["low", "medium", "high"], weights=[5, 3, 2])[0]
        else:
            priority = random.choices(["low", "medium", "high"], weights=[2, 4, 4])[0]

        tasks.append({
            "type": "custom",
            "description": desc,
            "location": "",
            "priority": priority,
            "execute_time": exec_time.strftime("%Y-%m-%d %H:%M:%S"),
            "creator": CREATOR,
            "status": "pending",
            "model": random.choice(MODELS),
        })

    tasks.sort(key=lambda t: t["execute_time"])
    return tasks


def fallback_generate(date):
    """Template-based fallback if LLM fails."""
    objects = [
        "an apple", "a banana", "an orange",
        "a chocolate marked with Snickers", "red packaged cake",
        "Oreo original flavor sandwich cookie box",
        "coca-cola", "a bottle of water",
        "Orion Shuyuan non-fried potato chips",
        "Vitasoy chocolate soya drink",
    ]
    names = ["Okng", "yyw", "zkm", "taoshida", "zsx", "wyj"]

    def rt(d):
        hour = random.choice(list(range(9, 12))*2 + list(range(14, 19))*4 + list(range(19, 21)))
        return datetime(d.year, d.month, d.day, hour, random.randint(0, 59), random.randint(0, 59))

    descs = []

    simple = [
        "find {n}", "say hello", "go home", "Check the environment.",
        "Inspect the current environment.", "explore the office",
        "tell me a joke", "find {o}", "look for {o}",
        "what time is it", "Find {n}.", "say goodbye",
        "come to find {n}", "where is {n}",
    ]
    for _ in range(15):
        descs.append(random.choice(simple).format(n=random.choice(names), o=random.choice(objects)))

    medium = [
        "pick up {o} for me", "help me get {o}", "give me {o}",
        "find {n} and say hello", "say hello to {n}",
        "could you help me find {o}",
        "Pick {o} and place it on the table",
        "go to the snack area and pick up {o}",
        "could you give me something to eat?",
        "help me get my favorite fruit",
        "pick up {o} for {n}", "bring {o} to {n}",
        "deliver some food for {n}",
        "A bottle of water, please.",
    ]
    for _ in range(20):
        descs.append(random.choice(medium).format(n=random.choice(names), o=random.choice(objects)))

    hard = [
        "please help me deliver the {o} to student {n}",
        "please go to the snack area to pick up {o} for me",
        "Find {n1} and {n2}, tell them there's a PPT they need to make",
        "Can you check if {n} is at his workstation, then come back and let me know?",
        "Go to workstation {ws}, check if the monitor is on, then come back and tell {n} the result",
        "notify student {n} to have a meeting in the 511 conference room",
        "I'm hungry. Can you get me a food that can quickly relieve my hunger?",
        "Find {n}, then say to them: 'Good afternoon, work hard.'",
        "pick up {o} and place it to {n}'s desk",
        "choose a red color fruit and deliver it to {n}",
        "Explore the office and find the snack area",
    ]
    for _ in range(15):
        n1 = random.choice(names)
        n2 = random.choice([x for x in names if x != n1])
        descs.append(random.choice(hard).format(
            n=random.choice(names), n1=n1, n2=n2,
            o=random.choice(objects),
            ws=random.choice(["506B", "506J", "506L", "308"])))

    random.shuffle(descs)
    return assign_metadata(descs, date)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="LLM-powered robot task generator")
    parser.add_argument("--output", default="tasks_generated.csv")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--no-llm", action="store_true")
    args = parser.parse_args()

    if not args.no_llm and not API_TOKEN:
        print("WARNING: No ANTHROPIC_AUTH_TOKEN. Using template fallback.")
        args.no_llm = True

    start_date = datetime(2026, 5, 11)
    end_date = datetime(2026, 6, 3)

    dates = []
    current = start_date
    while current <= end_date:
        dates.append(current)
        current += timedelta(days=1)

    all_tasks = []
    llm_ok = 0
    fb_ok = 0

    print(f"Generating tasks: {start_date.date()} -> {end_date.date()}")
    print(f"{len(dates)} days, 50 tasks/day | Model: {API_MODEL}")
    print(f"LLM: {not args.no_llm} | Workers: {args.workers}\n")

    if args.no_llm:
        for d in dates:
            tasks = fallback_generate(d)
            all_tasks.extend(tasks)
            fb_ok += 1
            print(f"  {d.date()} — {len(tasks)} tasks (template)")
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {}
            for d in dates:
                f = executor.submit(generate_descriptions_for_date, d.strftime("%Y-%m-%d"))
                futures[f] = d

            for f in as_completed(futures):
                date = futures[f]
                try:
                    descs = f.result()
                    if len(descs) >= 30:
                        tasks = assign_metadata(descs, date)
                        all_tasks.extend(tasks)
                        llm_ok += 1
                        print(f"  {date.date()} — {len(tasks)} tasks (LLM)")
                    else:
                        raise ValueError(f"Only {len(descs)} descriptions")
                except Exception as e:
                    print(f"  {date.date()} — LLM failed ({e}), using template fallback")
                    tasks = fallback_generate(date)
                    all_tasks.extend(tasks)
                    fb_ok += 1

    # Sort all tasks by time
    all_tasks.sort(key=lambda t: t["execute_time"])

    # Write CSV
    fieldnames = ["type", "description", "location", "priority",
                  "execute_time", "creator", "status", "model"]
    output_path = Path(args.output)
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_tasks)

    from collections import Counter
    model_counts = Counter(t["model"] for t in all_tasks)
    priority_counts = Counter(t["priority"] for t in all_tasks)

    print(f"\n{'='*50}")
    print(f"Total: {len(all_tasks)} tasks over {len(dates)} days")
    print(f"LLM days: {llm_ok} | Fallback days: {fb_ok}")
    print(f"Models: {dict(model_counts)}")
    print(f"Priorities: {dict(priority_counts)}")
    print(f"Output: {output_path.resolve()}")

    # Samples
    print(f"\n--- Sample from May 11 ---")
    may11 = [t for t in all_tasks if t["execute_time"].startswith("2026-05-11")]
    for t in may11[:5]:
        print(f"  [{t['execute_time']}] {t['priority']:6s} | {t['description']}")

    print(f"\n--- Sample from June 3 ---")
    jun3 = [t for t in all_tasks if t["execute_time"].startswith("2026-06-03")]
    for t in jun3[-5:]:
        print(f"  [{t['execute_time']}] {t['priority']:6s} | {t['description']}")


if __name__ == "__main__":
    main()

# python generate_tasks.py --output my_tasks.csv --workers 10
