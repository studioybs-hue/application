/**
 * Informations légales — CREATIVINDUSTRY FRANCE (CIF)
 * Source: Extrait Kbis du 10/02/2026
 * Ces données sont utilisées dans toutes les pages légales et CGU/CGV.
 */
export const COMPANY = {
  // --- Identification société ---
  legalName: "CREATIVINDUSTRY FRANCE",
  sigle: "CIF",
  brand: "CINÉMARIÉS",
  brandTagline: "Une marque de CREATIVINDUSTRY FRANCE",

  legalForm: "Société par actions simplifiée (SAS)",
  capital: "101,00 EUR",
  rcs: "100 871 425 R.C.S. Paris",
  siren: "100 871 425",
  siret: "100 871 425 00012", // SIRET établissement principal Paris (00012 standard, à confirmer si besoin)
  euid: "FR7501.100871425",
  vatNumber: "FR89 100 871 425", // Calculé: clé 89

  // --- Adresse siège ---
  addressLine1: "60 rue François 1er",
  city: "75008 Paris",
  country: "France",

  // --- Contact ---
  email: "contact@creativindustry.com",
  phone: "07 49 20 89 22",
  phoneRaw: "+33749208922",
  website: "https://creativindustry.com",
  appWebsite: "https://cinemaries.fr",

  // --- Direction ---
  president: "Ali Youssouf",
  publicationDirector: "Ali Youssouf",

  // --- Hébergement ---
  host: {
    name: "IONOS SARL",
    address: "7 place de la Gare, BP 70109, 57201 Sarreguemines Cedex",
    country: "France",
    phone: "0970 808 911",
    website: "https://www.ionos.fr",
  },

  // --- DPO / Délégué à la protection des données ---
  dpo: {
    name: "Ali Youssouf (Président)",
    email: "contact@creativindustry.com",
  },

  // --- Activité ---
  activity:
    "Production, réalisation de vidéos et ingénierie audiovisuelle, captation et post-production de films, de vidéo et de programmes télévisés",
  apeCode: "5911C", // Code APE typique production audiovisuelle (à confirmer sur INSEE)

  // --- Service public ---
  serviceDescription:
    "CINÉMARIÉS est une plateforme de streaming sécurisée permettant aux mariés de visionner et partager leurs films de mariage via un code d'accès unique.",

  // --- Prix ---
  pricing: {
    subscription: { amount: 1.99, label: "1,99 € TTC / mois" },
    subscriptionUnlimited: { amount: 2.3, label: "2,30 € TTC / mois" },
    hosting: { amount: 90, label: "90 € TTC (paiement unique)" },
  },

  // --- Date dernière mise à jour ---
  lastUpdate: "21 mai 2026",
};

export const FULL_ADDRESS = `${COMPANY.addressLine1}, ${COMPANY.city}, ${COMPANY.country}`;
