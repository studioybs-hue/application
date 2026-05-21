"""Lightweight SMTP transactional mailer for CINÉMARIÉS.
Uses Python stdlib (smtplib) to avoid external deps.
"""
from __future__ import annotations
import os
import smtplib
import ssl
import asyncio
import logging
from email.message import EmailMessage
from email.utils import make_msgid, formataddr
from typing import Optional

log = logging.getLogger("mailer")


def _get_cfg():
    return {
        "host": os.environ.get("SMTP_HOST", ""),
        "port": int(os.environ.get("SMTP_PORT", "465") or 465),
        "user": os.environ.get("SMTP_USER", ""),
        "password": os.environ.get("SMTP_PASSWORD", ""),
        "from_email": os.environ.get("SMTP_FROM_EMAIL", "") or os.environ.get("SMTP_USER", ""),
        "from_name": os.environ.get("SMTP_FROM_NAME", "CINÉMARIÉS"),
        "use_ssl": (os.environ.get("SMTP_USE_SSL", "true").lower() in ("1", "true", "yes")),
    }


def is_configured() -> bool:
    cfg = _get_cfg()
    return bool(cfg["host"] and cfg["user"] and cfg["password"] and cfg["from_email"])


def _send_sync(to_email: str, subject: str, html: str, text: Optional[str] = None) -> bool:
    cfg = _get_cfg()
    if not is_configured():
        log.warning("[mailer] SMTP not configured; skipping email to %s", to_email)
        return False
    try:
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = formataddr((cfg["from_name"], cfg["from_email"]))
        msg["To"] = to_email
        msg["Message-ID"] = make_msgid(domain=cfg["from_email"].split("@")[-1])
        msg.set_content(text or _html_to_text(html))
        msg.add_alternative(html, subtype="html")

        if cfg["use_ssl"]:
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL(cfg["host"], cfg["port"], context=ctx, timeout=20) as s:
                s.login(cfg["user"], cfg["password"])
                s.send_message(msg)
        else:
            with smtplib.SMTP(cfg["host"], cfg["port"], timeout=20) as s:
                s.starttls(context=ssl.create_default_context())
                s.login(cfg["user"], cfg["password"])
                s.send_message(msg)
        log.info("[mailer] Email sent to %s : %s", to_email, subject)
        return True
    except Exception as e:
        log.error("[mailer] Failed to send to %s: %s", to_email, e)
        return False


def _html_to_text(html: str) -> str:
    import re
    txt = re.sub(r"<br\s*/?>", "\n", html)
    txt = re.sub(r"</p>", "\n\n", txt)
    txt = re.sub(r"<[^>]+>", "", txt)
    return txt.strip()


async def send_email(to_email: str, subject: str, html: str, text: Optional[str] = None) -> bool:
    """Async wrapper — runs SMTP in a thread to avoid blocking the event loop."""
    return await asyncio.to_thread(_send_sync, to_email, subject, html, text)


# --- Brand-styled HTML wrapper ---
def render_email(title: str, body_html: str, cta_label: Optional[str] = None, cta_url: Optional[str] = None) -> str:
    cta_html = ""
    if cta_label and cta_url:
        cta_html = f"""
        <div style="margin:24px 0;text-align:center">
          <a href="{cta_url}" style="display:inline-block;background:#D4AF37;color:#0A0A0A;
             text-decoration:none;font-weight:700;padding:14px 28px;border-radius:6px;
             font-family:Arial,sans-serif;font-size:14px;letter-spacing:0.5px">
             {cta_label}
          </a>
        </div>
        """
    return f"""<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>{title}</title></head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:Arial,Helvetica,sans-serif;color:#F5F1E8">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0A0A0A">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#1A1A1A;border-radius:12px;border:1px solid #2A2A2A;overflow:hidden">
        <tr><td style="padding:32px;text-align:center;border-bottom:1px solid #2A2A2A">
          <div style="color:#D4AF37;font-size:22px;font-weight:900;letter-spacing:6px">CINÉMARIÉS</div>
          <div style="color:#9A9A9A;font-size:11px;font-style:italic;margin-top:4px">Le cinéma de votre plus beau jour</div>
        </td></tr>
        <tr><td style="padding:32px 28px;color:#E5E2D6;font-size:15px;line-height:1.6">
          <h1 style="color:#F5F1E8;font-size:22px;margin:0 0 16px 0;font-weight:700">{title}</h1>
          {body_html}
          {cta_html}
        </td></tr>
        <tr><td style="padding:24px;background:#0A0A0A;border-top:1px solid #2A2A2A;text-align:center;color:#6A6A6A;font-size:11px;line-height:1.5">
          <div style="margin-bottom:6px">CREATIVINDUSTRY FRANCE — 60 rue François 1er, 75008 Paris</div>
          <div>RCS Paris 100 871 425 — SAS au capital de 101 €</div>
          <div style="margin-top:10px">
            <a href="https://cinemaries.fr/legal/mentions" style="color:#D4AF37;text-decoration:none;margin:0 6px">Mentions légales</a>·
            <a href="https://cinemaries.fr/legal/privacy" style="color:#D4AF37;text-decoration:none;margin:0 6px">Confidentialité</a>·
            <a href="https://cinemaries.fr/legal/cgu" style="color:#D4AF37;text-decoration:none;margin:0 6px">CGU</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""
