// @ts-nocheck
import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

// SEO constants - update once and the entire site reflects it
const SITE_NAME = "CINÉMARIÉS";
const SITE_TAGLINE = "Vos plus beaux mariages, comme au cinéma";
const SITE_DESCRIPTION =
  "CINÉMARIÉS — Studio vidéo de mariage haut de gamme. Découvrez les bandes-annonces de mariages tournés en France et accédez à votre film complet avec votre code unique. Hébergement vie entière, diffusion Chromecast, qualité cinéma.";
const SITE_URL = "https://cinemaries.fr";
const SITE_IMAGE = "https://cinemaries.fr/assets/og-image.jpg"; // fallback to favicon if not present
const SITE_KEYWORDS =
  "vidéaste mariage, film mariage, cinéaste mariage, vidéo mariage France, vidéaste de mariage, film de mariage, mariage haut de gamme, bande annonce mariage, hébergement film mariage, cinemaries, cinémariés";
const THEME_COLOR = "#0A0A0A";
const BRAND_GOLD = "#D4AF37";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="fr" style={{ height: "100%" }}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />

        {/* --- PRIMARY SEO --- */}
        <title>{SITE_NAME} — {SITE_TAGLINE}</title>
        <meta name="title" content={`${SITE_NAME} — ${SITE_TAGLINE}`} />
        <meta name="description" content={SITE_DESCRIPTION} />
        <meta name="keywords" content={SITE_KEYWORDS} />
        <meta name="author" content="CINÉMARIÉS" />
        <meta name="robots" content="index, follow" />
        <meta name="language" content="French" />
        <meta name="revisit-after" content="7 days" />

        {/* --- THEME / BROWSER UI --- */}
        <meta name="theme-color" content={THEME_COLOR} />
        <meta name="msapplication-TileColor" content={THEME_COLOR} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content={SITE_NAME} />
        <meta name="format-detection" content="telephone=no" />

        {/* --- OPEN GRAPH (Facebook, WhatsApp, LinkedIn) --- */}
        <meta property="og:type" content="website" />
        <meta property="og:locale" content="fr_FR" />
        <meta property="og:site_name" content={SITE_NAME} />
        <meta property="og:url" content={SITE_URL} />
        <meta property="og:title" content={`${SITE_NAME} — ${SITE_TAGLINE}`} />
        <meta property="og:description" content={SITE_DESCRIPTION} />
        <meta property="og:image" content={SITE_IMAGE} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="CINÉMARIÉS — Studio vidéo de mariage" />

        {/* --- TWITTER CARDS --- */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`${SITE_NAME} — ${SITE_TAGLINE}`} />
        <meta name="twitter:description" content={SITE_DESCRIPTION} />
        <meta name="twitter:image" content={SITE_IMAGE} />

        {/* --- CANONICAL & ALTERNATIVE DOMAINS --- */}
        <link rel="canonical" href={SITE_URL} />
        <link rel="alternate" hrefLang="fr" href={SITE_URL} />
        <link rel="alternate" hrefLang="x-default" href={SITE_URL} />

        {/* --- ICONS / PWA --- */}
        <link rel="icon" type="image/png" href="/assets/images/favicon.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/assets/images/icon.png" />

        {/* --- STRUCTURED DATA (Google rich results) --- */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "LocalBusiness",
              name: "CINÉMARIÉS",
              image: SITE_IMAGE,
              url: SITE_URL,
              description: SITE_DESCRIPTION,
              priceRange: "€€€",
              "@id": SITE_URL,
              areaServed: {
                "@type": "Country",
                name: "France",
              },
              serviceType: ["Vidéaste mariage", "Film de mariage", "Hébergement de film de mariage"],
              sameAs: [],
            }),
          }}
        />

        {/* --- PRELOAD GOLD ACCENT --- */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              :root { --brand-gold: ${BRAND_GOLD}; --brand-bg: ${THEME_COLOR}; }
              html, body { background: ${THEME_COLOR}; }
              ::selection { background: ${BRAND_GOLD}; color: ${THEME_COLOR}; }
            `,
          }}
        />

        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              body > div:first-child { position: fixed !important; top: 0; left: 0; right: 0; bottom: 0; }
              [role="tablist"] [role="tab"] * { overflow: visible !important; }
              [role="heading"], [role="heading"] * { overflow: visible !important; }
            `,
          }}
        />
      </head>
      <body
        style={{
          margin: 0,
          height: "100%",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </body>
    </html>
  );
}
