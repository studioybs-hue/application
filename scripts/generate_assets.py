"""One-time script to generate CINÉMARIÉS branding assets via Gemini Nano Banana.
Generates: splash.png, icon.png, adaptive-icon.png.
Run: python /app/scripts/generate_assets.py
"""
import asyncio
import base64
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / "backend" / ".env")

OUT = ROOT / "frontend" / "assets" / "images"
OUT.mkdir(parents=True, exist_ok=True)

API_KEY = os.getenv("EMERGENT_LLM_KEY")
MODEL = "gemini-3.1-flash-image-preview"

ASSETS = [
    {
        "name": "splash-icon.png",
        "prompt": (
            "Ultra-luxurious cinematic poster for a French wedding video streaming app called CINÉMARIÉS. "
            "Centered: the wordmark 'CINÉMARIÉS' in elegant serif gold-champagne capital letters with thin elegant kerning. "
            "Below the wordmark, a tiny italic tagline 'Le cinéma de votre plus beau jour' in ivory. "
            "Background: a deep cinematic black with very subtle gold particles, soft bokeh, two elegant intertwined wedding rings forming a subtle halo behind the text. "
            "Mood: French luxury, Vogue editorial, Cannes red-carpet cinematic, romantic. "
            "Vertical 1284x2778 aspect, minimal, very high quality, no other text, no logos. "
            "Color palette: deep black #0A0A0A, champagne gold #D4AF37, burgundy wine #722F37, ivory #FFFFF0."
        ),
    },
    {
        "name": "icon.png",
        "prompt": (
            "Mobile app icon, square 1024x1024, for a luxury French wedding video streaming app named CINÉMARIÉS. "
            "Deep black background, elegant golden monogram letters 'C' and 'M' intertwined like two interlocking wedding rings, "
            "with a subtle gold film-reel ribbon curling underneath. Centered, minimal, no other text. "
            "Champagne gold #D4AF37 on black #0A0A0A. Premium, clean, App Store quality icon, no border."
        ),
    },
    {
        "name": "adaptive-icon.png",
        "prompt": (
            "Android adaptive icon foreground, 1024x1024 transparent background. "
            "Elegant golden monogram 'CM' intertwined as wedding rings with a small film-reel ribbon. "
            "Champagne gold #D4AF37, centered, minimal padding, no background, no text. Premium luxury feel."
        ),
    },
    {
        "name": "favicon.png",
        "prompt": (
            "Web favicon 256x256, deep black background, golden letter 'C' interlocked with 'M' "
            "forming wedding rings. Champagne gold on black. Minimal, premium, no text."
        ),
    },
]


async def gen(item):
    print(f"→ Generating {item['name']}...")
    chat = LlmChat(
        api_key=API_KEY,
        session_id=f"cinemaries-{item['name']}",
        system_message="You generate luxury cinematic branding visuals.",
    )
    chat.with_model("gemini", MODEL).with_params(modalities=["image", "text"])
    msg = UserMessage(text=item["prompt"])
    _, images = await chat.send_message_multimodal_response(msg)
    if not images:
        print(f"  ✗ no image for {item['name']}")
        return False
    img = images[0]
    image_bytes = base64.b64decode(img["data"])
    out_path = OUT / item["name"]
    with out_path.open("wb") as f:
        f.write(image_bytes)
    print(f"  ✓ saved {out_path} ({len(image_bytes)} bytes)")
    return True


async def main():
    if not API_KEY:
        print("EMERGENT_LLM_KEY not set", file=sys.stderr)
        sys.exit(1)
    for item in ASSETS:
        try:
            await gen(item)
        except Exception as e:
            print(f"  ✗ {item['name']}: {e}")


if __name__ == "__main__":
    asyncio.run(main())
