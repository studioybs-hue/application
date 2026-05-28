#!/usr/bin/env python3
"""
CINÉMARIÉS — Script de création des produits & prix Stripe
=========================================================

Ce script crée (ou réutilise) 3 produits + 3 prix récurrents dans votre
catalogue Stripe correspondant aux 3 abonnements de l'application.

Il est IDEMPOTENT : on peut le relancer sans risque, il ne créera pas
de doublons grâce à un identifiant unique (metadata `cinemaries_plan`).

USAGE :
    cd /var/www/cinemaries/backend
    python3 scripts/create_stripe_products.py

À la fin, le script affiche les 3 Price IDs à coller dans le `.env`.
"""

import os
import sys
from pathlib import Path

# Charger le .env
try:
    from dotenv import load_dotenv
    backend_dir = Path(__file__).resolve().parent.parent
    load_dotenv(backend_dir / ".env")
except ImportError:
    print("⚠️  python-dotenv non installé, lecture directe des variables d'environnement")

try:
    import stripe
except ImportError:
    print("❌ ERREUR : le module 'stripe' n'est pas installé.")
    print("   Lancez : pip install stripe")
    sys.exit(1)

# ----- Configuration -----
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "").strip()
CURRENCY = os.environ.get("STRIPE_PRICE_CURRENCY", "eur").lower()

if not STRIPE_API_KEY:
    print("❌ ERREUR : STRIPE_API_KEY introuvable dans le .env")
    sys.exit(1)

if not STRIPE_API_KEY.startswith(("sk_live_", "sk_test_")):
    print("❌ ERREUR : STRIPE_API_KEY semble invalide (doit commencer par sk_live_ ou sk_test_)")
    sys.exit(1)

stripe.api_key = STRIPE_API_KEY

MODE = "LIVE" if STRIPE_API_KEY.startswith("sk_live_") else "TEST"

# Définition des 3 plans à créer
# Le champ `cinemaries_plan` sert d'identifiant unique pour la déduplication
PLANS = [
    {
        "cinemaries_plan": "annual_commit",
        "product_name": "CINÉMARIÉS — Premium Annuel (Engagement 12 mois)",
        "product_description": (
            "Abonnement Premium annuel avec engagement de 12 mois. "
            "Accès illimité à votre vidéo de mariage en haute qualité, "
            "support prioritaire, partage avec vos proches."
        ),
        "amount": 2388,  # 23.88€
        "interval": "year",
        "nickname": "Annuel Engagement 12 mois — 23.88€/an",
    },
    {
        "cinemaries_plan": "annual_free",
        "product_name": "CINÉMARIÉS — Premium Annuel (Sans engagement)",
        "product_description": (
            "Abonnement Premium annuel sans engagement. "
            "Résiliable à tout moment. Accès illimité à votre vidéo de mariage."
        ),
        "amount": 2760,  # 27.60€
        "interval": "year",
        "nickname": "Annuel Libre — 27.60€/an",
    },
    {
        "cinemaries_plan": "monthly_free",
        "product_name": "CINÉMARIÉS — Premium Mensuel (Sans engagement)",
        "product_description": (
            "Abonnement Premium mensuel sans engagement. "
            "Résiliable à tout moment. Accès illimité à votre vidéo de mariage."
        ),
        "amount": 230,  # 2.30€
        "interval": "month",
        "nickname": "Mensuel Libre — 2.30€/mois",
    },
]


def find_existing_product(plan_code: str):
    """Cherche un produit existant via les metadata."""
    products = stripe.Product.search(query=f"metadata['cinemaries_plan']:'{plan_code}'")
    if products.data:
        return products.data[0]
    return None


def find_existing_price(product_id: str, amount: int, interval: str):
    """Cherche un prix récurrent existant pour ce produit, montant et intervalle."""
    prices = stripe.Price.list(product=product_id, active=True, limit=100)
    for p in prices.auto_paging_iter():
        if (
            p.unit_amount == amount
            and p.currency == CURRENCY
            and p.recurring
            and p.recurring.get("interval") == interval
        ):
            return p
    return None


def main():
    print("\n" + "=" * 70)
    print(f"🎬 CINÉMARIÉS — Configuration produits Stripe ({MODE})")
    print("=" * 70 + "\n")

    results = []

    for plan in PLANS:
        plan_code = plan["cinemaries_plan"]
        print(f"📦 Plan : {plan['nickname']}")

        # 1) Produit
        product = find_existing_product(plan_code)
        if product:
            print(f"   ✓ Produit existant trouvé : {product.id}")
            # Mettre à jour le nom/description si nécessaire
            stripe.Product.modify(
                product.id,
                name=plan["product_name"],
                description=plan["product_description"],
            )
        else:
            product = stripe.Product.create(
                name=plan["product_name"],
                description=plan["product_description"],
                metadata={"cinemaries_plan": plan_code},
            )
            print(f"   ✨ Produit créé : {product.id}")

        # 2) Prix
        price = find_existing_price(product.id, plan["amount"], plan["interval"])
        if price:
            print(f"   ✓ Prix existant trouvé : {price.id}")
        else:
            price = stripe.Price.create(
                product=product.id,
                currency=CURRENCY,
                unit_amount=plan["amount"],
                recurring={"interval": plan["interval"]},
                nickname=plan["nickname"],
                metadata={"cinemaries_plan": plan_code},
            )
            print(f"   ✨ Prix créé : {price.id}")

        results.append({
            "plan_code": plan_code,
            "product_id": product.id,
            "price_id": price.id,
            "amount": plan["amount"],
            "interval": plan["interval"],
        })
        print()

    # ----- Affichage final -----
    print("=" * 70)
    print("✅ TERMINÉ ! Ajoutez ces 3 lignes dans /var/www/cinemaries/backend/.env :")
    print("=" * 70 + "\n")

    env_lines = []
    for r in results:
        env_var = f"STRIPE_PRICE_ID_{r['plan_code'].upper()}"
        line = f"{env_var}={r['price_id']}"
        env_lines.append(line)
        print(f"  {line}")

    print("\n" + "=" * 70)
    print("📋 Commande prête à coller (copier-coller dans le terminal du VPS) :")
    print("=" * 70 + "\n")
    for line in env_lines:
        print(f'echo "{line}" >> /var/www/cinemaries/backend/.env')
    print("\nsudo systemctl restart cinemaries-backend")
    print("\n" + "=" * 70 + "\n")


if __name__ == "__main__":
    try:
        main()
    except stripe.error.AuthenticationError:
        print("❌ ERREUR : Clé Stripe invalide. Vérifiez STRIPE_API_KEY dans .env")
        sys.exit(1)
    except stripe.error.StripeError as e:
        print(f"❌ ERREUR Stripe : {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ ERREUR inattendue : {type(e).__name__} : {e}")
        sys.exit(1)
