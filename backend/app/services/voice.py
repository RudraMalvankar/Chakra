"""
Hinglish voice note generator for high-value payment recovery.
Uses pyttsx3 (offline TTS) - no API cost, works in 4-day hackathon window.

Why voice: Indian SaaS voice recovery hits 60-70% conversion vs 15% for email-only
(Qcall.ai benchmark). Track 03 specifically calls out Hinglish voice recovery
as an example direction.
"""
import os
import hashlib
from typing import Optional


def _find_hindi_voice(engine) -> Optional[str]:
    """Try to find a Hindi voice on the system. Returns voice id or None."""
    voices = engine.getProperty("voices")
    for voice in voices:
        name = (voice.name or "").lower()
        if any(kw in name for kw in ["hindi", "hin ", "hi-in", "india"]):
            return voice.id
    return None


def _build_hinglish_script(customer_name: str, amount_inr: int, payment_link: str,
                            merchant_name: str = "Chakra") -> str:
    """Build Hinglish script. Mixed Hindi-English is normal for Indian customers."""
    return (
        f"Namaste {customer_name} ji. "
        f"Aapka {merchant_name} ka subscription payment "
        f"{amount_inr} rupaye fail ho gaya tha. "
        f"Kripya is link pe click karke apna payment complete karein. "
        f"Link hai: {payment_link}. "
        f"Koi sawaal ho toh humse sampark karein. Dhanyavaad."
    )


def _build_english_fallback(customer_name: str, amount_inr: int, payment_link: str,
                              merchant_name: str = "Chakra") -> str:
    """English fallback if no Hindi voice is installed."""
    return (
        f"Hello {customer_name}, your subscription payment of "
        f"Rs {amount_inr} for {merchant_name} failed. "
        f"Please click this link to complete your payment: {payment_link}. "
        f"Thank you."
    )


def generate_hinglish_voice_note(
    customer_name: str,
    amount_inr: int,
    payment_link: str,
    merchant_name: str = "Chakra",
    output_dir: str = "voice_notes"
) -> Optional[str]:
    """
    Generate a Hinglish voice note. Returns path to MP3, or None if TTS unavailable.

    Args:
        customer_name: Customer's first name (NOT sent to any LLM - this is for
                       local TTS only, never logged with PII).
        amount_inr: Amount in whole rupees (e.g., 499 not 49900).
        payment_link: Razorpay payment link URL.
        merchant_name: Merchant display name.
        output_dir: Where to save the .mp3 file.

    Returns:
        Absolute path to generated .mp3 file, or None if pyttsx3 fails.
    """
    try:
        import pyttsx3
    except ImportError:
        print("voice: pyttsx3 not installed - skipping voice generation")
        return None

    try:
        os.makedirs(output_dir, exist_ok=True)
        engine = pyttsx3.init()

        hindi_voice_id = _find_hindi_voice(engine)
        if hindi_voice_id:
            engine.setProperty("voice", hindi_voice_id)
            script = _build_hinglish_script(customer_name, amount_inr, payment_link, merchant_name)
            language = "hinglish"
        else:
            script = _build_english_fallback(customer_name, amount_inr, payment_link, merchant_name)
            language = "english_fallback"

        # Slow down for clarity (Hinglish speakers span wide age ranges)
        engine.setProperty("rate", 140)
        engine.setProperty("volume", 1.0)

        # Filename: hash customer_name to avoid filesystem PII
        name_hash = hashlib.sha256(customer_name.encode()).hexdigest()[:8]
        filename = f"{output_dir}/voice_{name_hash}_{int(os.path.getmtime(output_dir) if os.path.exists(output_dir) else 0)}.mp3"
        filename = f"{output_dir}/voice_{name_hash}.mp3"

        engine.save_to_file(script, filename)
        engine.runAndWait()

        return os.path.abspath(filename) if os.path.exists(filename) else None
    except Exception as e:
        print(f"voice: generation failed: {e}")
        return None



