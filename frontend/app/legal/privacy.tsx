import { Linking, Text } from "react-native";
import { LegalPageWrapper, H2, H3, P, Bold, Bullet, InfoBox } from "@/src/legal/LegalPageWrapper";
import { COMPANY } from "@/src/legal/companyInfo";
import { colors } from "@/src/theme";

export default function PrivacyPolicy() {
  return (
    <LegalPageWrapper
      title="Politique de confidentialité"
      subtitle="Conforme au Règlement (UE) 2016/679 (RGPD) et à la loi Informatique et Libertés modifiée."
      lastUpdate={COMPANY.lastUpdate}
    >
      <InfoBox>
        Votre vie privée est essentielle. {COMPANY.legalName} s'engage à protéger vos données personnelles et à respecter scrupuleusement le RGPD.
      </InfoBox>

      <H2>1. Responsable du traitement</H2>
      <P>
        Le responsable du traitement de vos données personnelles est <Bold>{COMPANY.legalName}</Bold>, {COMPANY.legalForm}, immatriculée au RCS Paris sous le numéro {COMPANY.siren}, dont le siège social est situé {COMPANY.addressLine1}, {COMPANY.city}.
      </P>
      <P>
        <Bold>Contact RGPD / DPO</Bold> :{" "}
        <Text style={{ color: colors.gold }} onPress={() => Linking.openURL(`mailto:${COMPANY.dpo.email}`)}>
          {COMPANY.dpo.email}
        </Text>
      </P>

      <H2>2. Données personnelles collectées</H2>
      <H3>2.1 Données fournies directement par vous</H3>
      <Bullet><Bold>Création de compte</Bold> : nom, prénom, adresse email, mot de passe (haché bcrypt, jamais stocké en clair)</Bullet>
      <Bullet><Bold>Code d'accès vidéo</Bold> : code reçu par l'organisateur du mariage (8 caractères)</Bullet>
      <Bullet><Bold>Formulaire de contact</Bold> : nom, email, téléphone (optionnel), sujet, message</Bullet>
      <Bullet><Bold>Demande d'hébergement</Bold> : nom des mariés, date du mariage, lieu, fichiers vidéo téléversés</Bullet>

      <H3>2.2 Données collectées automatiquement</H3>
      <Bullet><Bold>Adresse IP</Bold> (pour la sécurité, la prévention de fraude et la conformité aux ordonnances judiciaires)</Bullet>
      <Bullet><Bold>Identifiant d'appareil unique</Bold> : généré aléatoirement, stocké localement, utilisé pour lier 1 code à 1 appareil</Bullet>
      <Bullet><Bold>Logs techniques</Bold> : horodatage, type de requête, user-agent (navigateur/app)</Bullet>
      <Bullet><Bold>Données de paiement</Bold> : gérées exclusivement par Stripe. Nous ne stockons aucun numéro de carte bancaire.</Bullet>

      <H2>3. Finalités et bases légales</H2>
      <Bullet><Bold>Exécution du contrat (art. 6.1.b RGPD)</Bold> : création de compte, accès aux films, gestion de l'abonnement, hébergement payant</Bullet>
      <Bullet><Bold>Obligation légale (art. 6.1.c)</Bold> : facturation, comptabilité, lutte contre la fraude, conservation des données de connexion (loi LCEN)</Bullet>
      <Bullet><Bold>Intérêt légitime (art. 6.1.f)</Bold> : sécurité du service (limitation 1 code = 1 appareil), prévention des abus, amélioration du service</Bullet>
      <Bullet><Bold>Consentement (art. 6.1.a)</Bold> : envoi du formulaire de contact, communications commerciales optionnelles</Bullet>

      <H2>4. Durées de conservation</H2>
      <Bullet><Bold>Compte utilisateur</Bold> : jusqu'à la suppression du compte par l'utilisateur, puis 30 jours en sauvegarde technique</Bullet>
      <Bullet><Bold>Films de mariage</Bold> : durée de l'hébergement souscrit (offre 90€ = à vie, sous réserve de poursuite du service)</Bullet>
      <Bullet><Bold>Données de facturation</Bold> : 10 ans (obligation comptable - art. L.123-22 Code de commerce)</Bullet>
      <Bullet><Bold>Logs de connexion (IP)</Bold> : 12 mois (loi LCEN n° 2004-575)</Bullet>
      <Bullet><Bold>Demandes de contact</Bold> : 3 ans à compter du dernier échange</Bullet>
      <Bullet><Bold>Demandes d'hébergement non finalisées</Bold> : 12 mois</Bullet>

      <H2>5. Destinataires des données</H2>
      <P>Vos données sont strictement réservées aux personnels habilités de {COMPANY.legalName}. Elles sont communiquées aux sous-traitants suivants, uniquement pour les besoins du service :</P>
      <Bullet><Bold>Stripe Payments Europe Ltd</Bold> (Irlande) — traitement des paiements. Les flux financiers transitent via l'UE.</Bullet>
      <Bullet><Bold>IONOS SARL</Bold> (France) — hébergement des serveurs et stockage vidéo.</Bullet>
      <P>Aucune donnée n'est vendue, louée ou transférée à des tiers à des fins commerciales.</P>

      <H2>6. Transferts hors UE</H2>
      <P>
        Vos données sont hébergées <Bold>exclusivement en France</Bold> (IONOS, Sarreguemines). Aucun transfert systématique vers des pays tiers n'est effectué. En cas de transfert exceptionnel, celui-ci serait encadré par les Clauses Contractuelles Types de la Commission européenne.
      </P>

      <H2>7. Sécurité</H2>
      <Bullet>Connexion 100% chiffrée HTTPS (TLS 1.3, certificat Let's Encrypt)</Bullet>
      <Bullet>Mots de passe hachés avec bcrypt (jamais stockés en clair, ni accessibles à notre équipe)</Bullet>
      <Bullet>Tokens d'authentification JWT à durée limitée</Bullet>
      <Bullet>Accès admin restreint et authentifié</Bullet>
      <Bullet>Sauvegardes chiffrées régulières</Bullet>
      <Bullet>Notification CNIL sous 72h en cas de violation grave (art. 33 RGPD)</Bullet>

      <H2>8. Vos droits</H2>
      <P>Conformément aux articles 15 à 22 du RGPD, vous disposez à tout moment des droits suivants :</P>
      <Bullet><Bold>Droit d'accès</Bold> : obtenir copie de vos données</Bullet>
      <Bullet><Bold>Droit de rectification</Bold> : corriger des données inexactes</Bullet>
      <Bullet><Bold>Droit à l'effacement</Bold> ("droit à l'oubli") : supprimer votre compte et données</Bullet>
      <Bullet><Bold>Droit à la portabilité</Bold> : exporter vos données au format JSON</Bullet>
      <Bullet><Bold>Droit d'opposition</Bold> : refuser certains traitements</Bullet>
      <Bullet><Bold>Droit à la limitation</Bold> : suspendre temporairement le traitement</Bullet>
      <Bullet><Bold>Droit de définir des directives post-mortem</Bold></Bullet>

      <InfoBox>
        <Bold>Comment exercer vos droits ?</Bold>{"\n"}
        • Directement depuis votre profil : boutons « Exporter mes données » et « Supprimer mon compte ».{"\n"}
        • Par email à <Bold>{COMPANY.dpo.email}</Bold> (réponse sous 30 jours max).
      </InfoBox>

      <H2>9. Cookies et traceurs</H2>
      <P>
        Le service {COMPANY.brand} <Bold>n'utilise aucun cookie publicitaire</Bold>, ni Google Analytics, ni pixel Meta, ni outil de tracking comportemental.
      </P>
      <P>Seuls des cookies/stockages strictement nécessaires sont utilisés :</P>
      <Bullet><Bold>Token de session JWT</Bold> : pour vous maintenir connecté</Bullet>
      <Bullet><Bold>Identifiant d'appareil local</Bold> : pour la sécurité 1 code = 1 appareil</Bullet>
      <P>Ces cookies fonctionnels sont exemptés de consentement (art. 82 loi Informatique et Libertés, lignes directrices CNIL).</P>

      <H2>10. Mineurs</H2>
      <P>
        Le service {COMPANY.brand} s'adresse à un public adulte (couples mariés et leur entourage). Nous ne collectons pas sciemment de données de mineurs de moins de 15 ans. Si un parent constate une telle collecte, merci de nous contacter immédiatement à {COMPANY.email} pour suppression.
      </P>

      <H2>11. Modification de la politique</H2>
      <P>
        {COMPANY.legalName} se réserve le droit de modifier la présente politique. Toute modification substantielle vous sera notifiée par email ou via l'application. La version applicable est celle en vigueur à la date d'utilisation du service.
      </P>

      <H2>12. Réclamation CNIL</H2>
      <P>
        Si vous estimez que vos droits ne sont pas respectés, vous pouvez introduire une réclamation auprès de la Commission Nationale de l'Informatique et des Libertés (CNIL) :{" "}
        <Text style={{ color: colors.gold }} onPress={() => Linking.openURL("https://www.cnil.fr/fr/plaintes")}>
          www.cnil.fr/fr/plaintes
        </Text>
      </P>
      <Bullet>Adresse : 3 Place de Fontenoy, TSA 80715, 75334 Paris Cedex 07</Bullet>
      <Bullet>Téléphone : 01 53 73 22 22</Bullet>
    </LegalPageWrapper>
  );
}
