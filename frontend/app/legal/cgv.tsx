import { Linking, Text } from "react-native";
import { LegalPageWrapper, H2, H3, P, Bold, Bullet, InfoBox } from "@/src/legal/LegalPageWrapper";
import { COMPANY } from "@/src/legal/companyInfo";
import { colors } from "@/src/theme";

export default function CGV() {
  return (
    <LegalPageWrapper
      title="Conditions Générales de Vente"
      subtitle="CGV applicables aux abonnements Premium et aux prestations d'hébergement du service CINÉMARIÉS."
      lastUpdate={COMPANY.lastUpdate}
    >
      <H2>Article 1 — Champ d'application</H2>
      <P>
        Les présentes Conditions Générales de Vente (« CGV ») s'appliquent à toute commande passée par un consommateur ou un professionnel (« Client ») auprès de {COMPANY.legalName} via le site {COMPANY.appWebsite} ou l'application mobile {COMPANY.brand}.
      </P>
      <P>
        Toute commande implique l'acceptation sans réserve des présentes CGV.
      </P>

      <H2>Article 2 — Vendeur</H2>
      <Bullet>{COMPANY.legalName} — {COMPANY.legalForm}</Bullet>
      <Bullet>Siège : {COMPANY.addressLine1}, {COMPANY.city}</Bullet>
      <Bullet>{COMPANY.rcs} — Capital : {COMPANY.capital}</Bullet>
      <Bullet>N° TVA intracom : {COMPANY.vatNumber}</Bullet>
      <Bullet>Email : {COMPANY.email} — Tél : {COMPANY.phone}</Bullet>

      <H2>Article 3 — Produits et services proposés</H2>
      <H3>3.1 Abonnement Premium Mariés</H3>
      <Bullet>Tarif : <Bold>{COMPANY.pricing.subscription.label}</Bold></Bullet>
      <Bullet>Sans engagement, résiliable à tout moment</Bullet>
      <Bullet>Permet de générer des codes d'invitation pour partager son film de mariage</Bullet>
      <Bullet>Reconduction automatique mensuelle jusqu'à résiliation</Bullet>

      <H3>3.2 Abonnement Premium Illimité</H3>
      <Bullet>Tarif : <Bold>{COMPANY.pricing.subscriptionUnlimited.label}</Bold></Bullet>
      <Bullet>Génération illimitée de codes</Bullet>
      <Bullet>Sans engagement, résiliable à tout moment</Bullet>

      <H3>3.3 Hébergement à vie</H3>
      <Bullet>Tarif : <Bold>{COMPANY.pricing.hosting.label}</Bold></Bullet>
      <Bullet>Stockage et diffusion sécurisée du film de mariage du Client</Bullet>
      <Bullet>Durée : à vie, sous réserve de continuité du service par {COMPANY.legalName}</Bullet>
      <Bullet>Inclus : poster, bande-annonce, film complet, génération de codes d'accès</Bullet>

      <H2>Article 4 — Commande et paiement</H2>
      <Bullet>Les paiements sont traités par <Bold>Stripe Payments Europe Ltd</Bold> (Irlande), prestataire agréé PCI-DSS niveau 1</Bullet>
      <Bullet>Moyens de paiement acceptés : cartes bancaires Visa, Mastercard, American Express</Bullet>
      <Bullet>Connexion 100% chiffrée (TLS 1.3)</Bullet>
      <Bullet>{COMPANY.legalName} ne stocke <Bold>aucune donnée bancaire</Bold></Bullet>
      <Bullet>La commande est validée à réception de la confirmation de paiement par Stripe</Bullet>
      <Bullet>Une facture électronique est disponible sur demande à {COMPANY.email}</Bullet>

      <H2>Article 5 — Prix et TVA</H2>
      <P>
        Les prix affichés sont exprimés en <Bold>euros (EUR) toutes taxes comprises (TTC)</Bold>, TVA française au taux normal en vigueur incluse (20 %). {COMPANY.legalName} se réserve le droit de modifier ses tarifs à tout moment ; les commandes en cours restent toutefois facturées au tarif en vigueur lors de leur validation.
      </P>

      <H2>Article 6 — Droit de rétractation</H2>
      <InfoBox>
        Conformément à l'article L.221-28 13° du Code de la consommation, <Bold>le droit de rétractation ne peut être exercé pour les contenus numériques fournis sur support immatériel dont l'exécution a commencé après l'accord exprès du consommateur et son renoncement exprès à son droit de rétractation.</Bold>
      </InfoBox>
      <P>
        <Bold>Abonnement Premium</Bold> : en validant votre commande, vous demandez expressément l'accès immédiat au service et renoncez expressément à votre droit de rétractation de 14 jours. Vous conservez néanmoins la possibilité de résilier à tout moment (voir Article 8).
      </P>
      <P>
        <Bold>Hébergement à vie (90 €)</Bold> : en validant votre commande, vous acceptez le démarrage immédiat de l'exécution du contrat (mise à disposition du stockage et de l'infrastructure de diffusion) et renoncez expressément au droit de rétractation. À défaut d'acceptation expresse, vous disposez d'un délai de 14 jours pour vous rétracter.
      </P>

      <H2>Article 7 — Reconduction tacite et résiliation des abonnements</H2>
      <P>
        Conformément à la loi Chatel (art. L.215-1 et suivants du Code de la consommation), {COMPANY.legalName} vous informe :
      </P>
      <Bullet>Votre abonnement est reconduit automatiquement chaque mois</Bullet>
      <Bullet>Vous pouvez le résilier à tout moment depuis votre profil → « Gérer mon abonnement »</Bullet>
      <Bullet>La résiliation prend effet à la fin de la période en cours, sans frais</Bullet>
      <Bullet>Vous conservez l'accès Premium jusqu'à cette date</Bullet>
      <Bullet>Aucun remboursement au prorata n'est dû pour la période entamée</Bullet>

      <H2>Article 8 — Politique de remboursement</H2>
      <P>
        <Bold>Cas où un remboursement peut être accordé :</Bold>
      </P>
      <Bullet>Erreur de facturation imputable à {COMPANY.legalName} (double prélèvement, etc.)</Bullet>
      <Bullet>Indisponibilité totale et prolongée du service (&gt; 7 jours consécutifs) due à {COMPANY.legalName}</Bullet>
      <Bullet>Cas de force majeure rendant le service totalement inutilisable</Bullet>
      <P>
        <Bold>Cas où aucun remboursement ne sera accordé :</Bold>
      </P>
      <Bullet>Période d'abonnement déjà écoulée</Bullet>
      <Bullet>Insatisfaction subjective non justifiée</Bullet>
      <Bullet>Incompatibilité avec un équipement utilisateur</Bullet>
      <Bullet>Hébergement à vie une fois les fichiers téléversés et publiés</Bullet>
      <P>
        Toute demande de remboursement doit être adressée par email à <Bold>{COMPANY.email}</Bold> avec justificatifs. Réponse sous 14 jours.
      </P>

      <H2>Article 9 — Garantie légale</H2>
      <P>
        En tant que professionnel, {COMPANY.legalName} reste tenu de la garantie légale de conformité (art. L.217-3 et suivants Code de la consommation) et de la garantie contre les vices cachés (art. 1641 Code civil) pour les services fournis.
      </P>

      <H2>Article 10 — Réclamation et médiation</H2>
      <P>
        Toute réclamation doit être adressée préalablement à <Bold>{COMPANY.email}</Bold>. À défaut de réponse satisfaisante sous 60 jours, le consommateur peut saisir gratuitement un médiateur de la consommation, ou la plateforme européenne de Règlement en Ligne des Litiges :
      </P>
      <P>
        <Text style={{ color: colors.gold }} onPress={() => Linking.openURL("https://ec.europa.eu/consumers/odr")}>
          https://ec.europa.eu/consumers/odr
        </Text>
      </P>

      <H2>Article 11 — Force majeure</H2>
      <P>
        {COMPANY.legalName} ne saurait être tenu responsable d'un manquement à ses obligations résultant d'un cas de force majeure (catastrophe naturelle, guerre, pandémie, cyberattaque massive, panne généralisée des opérateurs télécoms, décision administrative ou judiciaire).
      </P>

      <H2>Article 12 — Données personnelles</H2>
      <P>
        Le traitement des données nécessaires à l'exécution du contrat est décrit dans notre Politique de Confidentialité.
      </P>

      <H2>Article 13 — Droit applicable et juridiction</H2>
      <P>
        Les présentes CGV sont soumises au <Bold>droit français</Bold>. Tout litige sera de la compétence des tribunaux du ressort de Paris, sous réserve des dispositions impératives protectrices du consommateur (qui peut saisir le tribunal de son domicile).
      </P>

      <InfoBox>
        Pour toute question commerciale : <Bold>{COMPANY.email}</Bold> — {COMPANY.phone}
      </InfoBox>
    </LegalPageWrapper>
  );
}
